#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "net/http"
require "set"
require "uri"
require "yaml"

TOKEN = ENV.fetch("SYNC_LABELS_TOKEN", "")
OWNER = ENV.fetch("SYNC_LABELS_OWNER", "")
CONFIG_FILE = ENV.fetch("SYNC_LABELS_CONFIG_FILE", ".github/labels.yml")
POLICY_FILE = ENV.fetch("SYNC_LABELS_POLICY_FILE", ".github/label-policy.yml")
ONLY_REPOSITORY = ENV.fetch("SYNC_LABELS_REPOSITORY", "").strip
API_URL = ENV.fetch("SYNC_LABELS_API_URL", "https://api.github.com").sub(%r{/\z}, "")
DRY_RUN = %w[1 true yes on].include?(ENV.fetch("SYNC_LABELS_DRY_RUN", "true").downcase)

class GitHubApi
  DEFAULT_MAX_RETRIES = 3
  MAX_RETRY_DELAY = 60
  TRANSIENT_ERRORS = [
    EOFError,
    Errno::ECONNRESET,
    Errno::ETIMEDOUT,
    Net::OpenTimeout,
    Net::ReadTimeout,
    SocketError
  ].freeze

  def initialize(
    token:,
    base_url:,
    requester: nil,
    sleeper: ->(delay) { sleep(delay) },
    max_retries: DEFAULT_MAX_RETRIES
  )
    base_uri = URI.parse(base_url)
    unless base_uri.is_a?(URI::HTTPS) && base_uri.host && !base_uri.host.empty?
      raise ArgumentError, "GitHub API 地址必须是有效的 HTTPS URL。"
    end
    if base_uri.userinfo || base_uri.query || base_uri.fragment
      raise ArgumentError, "GitHub API 地址不能包含凭据、查询参数或片段。"
    end

    @token = token
    @base_url = base_url.sub(%r{/\z}, "")
    @requester = requester || method(:perform_request)
    @sleeper = sleeper
    @max_retries = Integer(max_retries)
    raise ArgumentError, "max_retries 不能小于 0。" if @max_retries.negative?
  end

  def get(path)
    request(Net::HTTP::Get, path)
  end

  def post(path, body)
    request(Net::HTTP::Post, path, body)
  end

  def patch(path, body)
    request(Net::HTTP::Patch, path, body)
  end

  def delete(path)
    request(Net::HTTP::Delete, path)
  end

  def paginate(path)
    results = []
    page = 1

    loop do
      separator = path.include?("?") ? "&" : "?"
      batch = get("#{path}#{separator}per_page=100&page=#{page}")
      raise "GitHub API 分页结果不是数组。" unless batch.is_a?(Array)

      results.concat(batch)
      break if batch.length < 100

      page += 1
    end

    results
  end

  private

  def request(request_class, path, body = nil)
    uri = URI.parse("#{@base_url}#{path}")
    request = request_class.new(uri)
    request["Accept"] = "application/vnd.github+json"
    request["Authorization"] = "Bearer #{@token}"
    request["User-Agent"] = "matharts-sync-labels"
    request["X-GitHub-Api-Version"] = "2022-11-28"

    unless body.nil?
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(body)
    end

    response = request_with_retries(uri, request)

    unless response.code.to_i.between?(200, 299)
      message = begin
        parsed = JSON.parse(response.body.to_s)
        parsed["message"] || response.body.to_s
      rescue JSON::ParserError
        response.body.to_s
      end

      details = [
        "GitHub API request failed",
        "Method: #{request.method}",
        "Path: #{path}",
        "Status: #{response.code}",
        "Message: #{message}"
      ]

      accepted_permissions = response["x-accepted-github-permissions"].to_s
      oauth_scopes = response["x-oauth-scopes"].to_s
      details << "Accepted permissions: #{accepted_permissions}" unless accepted_permissions.empty?
      details << "Token scopes: #{oauth_scopes}" unless oauth_scopes.empty?

      raise details.join("\n")
    end

    return nil if response.body.nil? || response.body.empty?

    JSON.parse(response.body)
  end

  def perform_request(uri, request)
    Net::HTTP.start(
      uri.hostname,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: 15,
      read_timeout: 60
    ) do |http|
      http.request(request)
    end
  end

  def request_with_retries(uri, request)
    attempt = 0

    loop do
      begin
        response = @requester.call(uri, request)
      rescue *TRANSIENT_ERRORS => error
        raise if attempt >= @max_retries

        delay = [2**attempt, MAX_RETRY_DELAY].min
        warn "GitHub API 网络错误，#{delay} 秒后重试（#{attempt + 1}/#{@max_retries}）：#{error.class}"
        @sleeper.call(delay)
        attempt += 1
        next
      end

      return response unless retryable_response?(response) && attempt < @max_retries

      delay = retry_delay(response, attempt)
      warn "GitHub API 返回 #{response.code}，#{delay} 秒后重试（#{attempt + 1}/#{@max_retries}）。"
      @sleeper.call(delay)
      attempt += 1
    end
  end

  def retryable_response?(response)
    status = response.code.to_i
    return true if status == 429 || status.between?(500, 599)

    status == 403 && (
      !response["retry-after"].to_s.empty? || response["x-ratelimit-remaining"].to_s == "0"
    )
  end

  def retry_delay(response, attempt)
    retry_after = response["retry-after"].to_s
    return [retry_after.to_i, MAX_RETRY_DELAY].min if retry_after.match?(/\A\d+\z/)

    reset_at = response["x-ratelimit-reset"].to_s
    if reset_at.match?(/\A\d+\z/)
      return [[reset_at.to_i - Time.now.to_i, 0].max, MAX_RETRY_DELAY].min
    end

    [2**attempt, MAX_RETRY_DELAY].min
  end
end

def label_key(value)
  value.to_s.unicode_normalize(:nfc).downcase
rescue StandardError
  value.to_s.downcase
end

def escape_segment(value)
  URI.encode_www_form_component(value.to_s).gsub("+", "%20")
end

def repository_path(full_name)
  owner, repository = full_name.split("/", 2)
  raise "无效仓库名称：#{full_name.inspect}" if owner.to_s.empty? || repository.to_s.empty?

  "#{escape_segment(owner)}/#{escape_segment(repository)}"
end

def load_yaml(path, description)
  YAML.safe_load(
    File.read(path, encoding: "UTF-8"),
    permitted_classes: [],
    permitted_symbols: [],
    aliases: false
  )
rescue Errno::ENOENT
  raise "找不到#{description}：#{path}"
rescue Psych::SyntaxError => error
  raise "#{description} YAML 无效：#{error.message}"
end

def load_labels(path)
  parsed = load_yaml(path, "标签配置文件")

  raise "#{path} 的 YAML 根节点必须是数组。" unless parsed.is_a?(Array)
  raise "#{path} 不能为空。" if parsed.empty?

  allowed_keys = Set.new(%w[name color description aliases])

  labels = parsed.map.with_index do |entry, index|
    raise "#{path} 第 #{index + 1} 项必须是对象。" unless entry.is_a?(Hash)

    unknown_keys = entry.keys.map(&:to_s).to_set - allowed_keys
    unless unknown_keys.empty?
      raise "#{path} 第 #{index + 1} 项包含未知字段：#{unknown_keys.to_a.sort.join(', ')}"
    end

    name = entry["name"].to_s.strip
    color = entry["color"].to_s.delete_prefix("#").upcase
    description = entry.fetch("description", "").to_s.strip
    aliases = Array(entry["aliases"]).map { |value| value.to_s.strip }

    raise "#{path} 第 #{index + 1} 项缺少 name。" if name.empty?
    raise "标签名称超过 50 个字符：#{name}" if name.length > 50
    raise "#{name} 的 color 必须是六位十六进制值。" unless color.match?(/\A[0-9A-F]{6}\z/)
    raise "#{name} 的 description 超过 100 个字符。" if description.length > 100
    raise "#{name} 的 aliases 不能包含空值。" if aliases.any?(&:empty?)

    {
      "name" => name,
      "color" => color,
      "description" => description,
      "aliases" => aliases
    }
  end

  desired_names = labels.map { |label| label_key(label["name"]) }
  raise "#{path} 包含重复标签名称。" unless desired_names.uniq.length == desired_names.length

  desired_set = desired_names.to_set
  alias_owners = {}

  labels.each do |label|
    normalized_aliases = label["aliases"].map { |name| label_key(name) }
    raise "#{label['name']} 包含重复 aliases。" unless normalized_aliases.uniq.length == normalized_aliases.length

    label["aliases"].each do |alias_name|
      alias_key = label_key(alias_name)
      if desired_set.include?(alias_key)
        raise "#{label['name']} 的 alias #{alias_name.inspect} 同时是正式标签名称。"
      end
      if alias_owners.key?(alias_key)
        raise "alias #{alias_name.inspect} 同时映射到 #{alias_owners[alias_key]} 和 #{label['name']}。"
      end

      alias_owners[alias_key] = label["name"]
    end
  end

  labels
end

def policy_string_list(container, key, path, allow_empty: false)
  values = container[key]
  raise "#{path} 的 #{key} 必须是数组。" unless values.is_a?(Array)

  normalized = values.map { |value| value.to_s.strip }
  raise "#{path} 的 #{key} 不能包含空值。" if normalized.any?(&:empty?)
  raise "#{path} 的 #{key} 不能为空。" if !allow_empty && normalized.empty?

  keys = normalized.map { |value| label_key(value) }
  raise "#{path} 的 #{key} 包含重复值。" unless keys.uniq.length == keys.length

  normalized
end

def load_policy(path)
  parsed = load_yaml(path, "标签同步策略文件")
  raise "#{path} 的 YAML 根节点必须是对象。" unless parsed.is_a?(Hash)

  allowed_root = Set.new(%w[version managed repositories])
  unknown_root = parsed.keys.map(&:to_s).to_set - allowed_root
  raise "#{path} 包含未知根字段：#{unknown_root.to_a.sort.join(', ')}" unless unknown_root.empty?
  raise "#{path} 的 version 必须是 1。" unless parsed["version"] == 1

  managed = parsed["managed"]
  repositories = parsed["repositories"]
  raise "#{path} 的 managed 必须是对象。" unless managed.is_a?(Hash)
  raise "#{path} 的 repositories 必须是对象。" unless repositories.is_a?(Hash)

  allowed_managed = Set.new(%w[prefixes exact_names legacy_names])
  unknown_managed = managed.keys.map(&:to_s).to_set - allowed_managed
  raise "#{path} 的 managed 包含未知字段：#{unknown_managed.to_a.sort.join(', ')}" unless unknown_managed.empty?

  allowed_repositories = Set.new(%w[include])
  unknown_repositories = repositories.keys.map(&:to_s).to_set - allowed_repositories
  unless unknown_repositories.empty?
    raise "#{path} 的 repositories 包含未知字段：#{unknown_repositories.to_a.sort.join(', ')}"
  end

  prefixes = policy_string_list(managed, "prefixes", path)
  exact_names = policy_string_list(managed, "exact_names", path, allow_empty: true)
  legacy_names = policy_string_list(managed, "legacy_names", path, allow_empty: true)
  repository_names = policy_string_list(repositories, "include", path)

  invalid_prefix = prefixes.find { |prefix| !prefix.end_with?(":") }
  raise "#{path} 的受管前缀必须以冒号结尾：#{invalid_prefix}" if invalid_prefix

  invalid_repository = repository_names.find { |name| !name.match?(/\A[A-Za-z0-9._-]+\z/) }
  raise "#{path} 包含无效仓库名称：#{invalid_repository}" if invalid_repository

  exact_keys = exact_names.map { |name| label_key(name) }.to_set
  legacy_keys = legacy_names.map { |name| label_key(name) }.to_set
  overlap = exact_keys & legacy_keys
  raise "#{path} 的 exact_names 与 legacy_names 不能重叠：#{overlap.to_a.sort.join(', ')}" unless overlap.empty?

  {
    prefixes: prefixes.map { |prefix| label_key(prefix) }.freeze,
    exact_names: exact_keys.freeze,
    legacy_names: legacy_keys.freeze,
    repositories: repository_names.freeze
  }.freeze
end

def desired_label_managed?(name, policy)
  key = label_key(name)
  policy[:prefixes].any? { |prefix| key.start_with?(prefix) } || policy[:exact_names].include?(key)
end

def managed_label?(name, policy)
  desired_label_managed?(name, policy) || policy[:legacy_names].include?(label_key(name))
end

def validate_label_policy!(labels, policy)
  unmanaged = labels.reject { |label| desired_label_managed?(label["name"], policy) }.map { |label| label["name"] }
  unless unmanaged.empty?
    raise "标签配置包含不在组织受管范围内的正式标签：#{unmanaged.sort.join(', ')}"
  end

  aliases = labels.flat_map { |label| label["aliases"] }.map { |name| label_key(name) }.to_set
  missing_legacy = aliases - policy[:legacy_names]
  unless missing_legacy.empty?
    raise "标签 aliases 必须同时登记到策略 legacy_names：#{missing_legacy.to_a.sort.join(', ')}"
  end

  desired = labels.map { |label| label_key(label["name"]) }.to_set
  legacy_conflicts = desired & policy[:legacy_names]
  unless legacy_conflicts.empty?
    raise "策略 legacy_names 不能同时是正式标签：#{legacy_conflicts.to_a.sort.join(', ')}"
  end
end

def normalize_requested_repository(owner, value)
  return "" if value.empty?

  parts = value.split("/", 2)
  if parts.length == 2
    requested_owner, repository = parts
    unless requested_owner.casecmp(owner).zero?
      raise "指定仓库不属于 #{owner} 组织：#{value}"
    end
    return repository
  end

  value
end

def load_repositories(api, owner, policy, only_repository)
  names = policy[:repositories]
  requested = normalize_requested_repository(owner, only_repository)

  unless requested.empty?
    selected = names.find { |name| name.casecmp(requested).zero? }
    raise "仓库 #{owner}/#{requested} 不在标签同步 Allowlist 中。" unless selected

    names = [selected]
  end

  names.map do |name|
    repository = api.get("/repos/#{escape_segment(owner)}/#{escape_segment(name)}")
    raise "GitHub API 未返回仓库对象：#{owner}/#{name}" unless repository.is_a?(Hash)

    full_name = repository["full_name"].to_s
    unless full_name.casecmp("#{owner}/#{name}").zero?
      raise "Allowlist 仓库解析不一致：期望 #{owner}/#{name}，实际 #{full_name.inspect}"
    end

    unsupported_states = []
    unsupported_states << "archived" if repository["archived"]
    unsupported_states << "disabled" if repository["disabled"]
    unsupported_states << "fork" if repository["fork"]
    unless unsupported_states.empty?
      raise "Allowlist 仓库 #{full_name} 处于不可同步状态：#{unsupported_states.join(', ')}。请先更新策略。"
    end

    repository
  end
end

def mutate(api, dry_run, method, *arguments)
  api.public_send(method, *arguments) unless dry_run
end

def sync_repository(api, full_name, desired_labels, policy:, dry_run:)
  path = repository_path(full_name)
  existing = api.paginate("/repos/#{path}/labels")
  labels_by_name = existing.to_h { |label| [label_key(label["name"]), label] }

  desired_keys = desired_labels.map { |label| label_key(label["name"]) }.to_set

  counts = {
    created: 0,
    updated: 0,
    renamed: 0,
    deleted: 0,
    unchanged: 0,
    preserved: 0
  }

  puts "::group::#{full_name}"

  desired_labels.each do |desired|
    desired_name = desired["name"]
    desired_key = label_key(desired_name)
    current = labels_by_name[desired_key]
    alias_matches = desired["aliases"].map { |alias_name| labels_by_name[label_key(alias_name)] }.compact
      .uniq { |label| label_key(label["name"]) }

    if current
      changed = current["name"] != desired_name ||
        current["color"].to_s.upcase != desired["color"] ||
        current["description"].to_s != desired["description"]

      if changed
        puts "#{dry_run ? 'WOULD UPDATE' : 'UPDATE'}     #{current['name']} -> #{desired_name}"
        mutate(
          api,
          dry_run,
          :patch,
          "/repos/#{path}/labels/#{escape_segment(current['name'])}",
          {
            new_name: desired_name,
            color: desired["color"],
            description: desired["description"]
          }
        )
        counts[:updated] += 1
      else
        puts "UNCHANGED       #{desired_name}"
        counts[:unchanged] += 1
      end

      labels_by_name.delete(label_key(current["name"]))
      labels_by_name[desired_key] = desired

      alias_matches.each do |legacy|
        legacy_name = legacy.fetch("name")
        puts "#{dry_run ? 'WOULD DELETE' : 'DELETE'}     legacy alias #{legacy_name}"
        mutate(api, dry_run, :delete, "/repos/#{path}/labels/#{escape_segment(legacy_name)}")
        labels_by_name.delete(label_key(legacy_name))
        counts[:deleted] += 1
      end

      next
    end

    if alias_matches.length > 1
      names = alias_matches.map { |label| label["name"] }.join(", ")
      raise "多个旧标签同时映射到 #{desired_name}：#{names}"
    end

    if alias_matches.length == 1
      old = alias_matches.first
      puts "#{dry_run ? 'WOULD RENAME' : 'RENAME'}     #{old['name']} -> #{desired_name}"
      mutate(
        api,
        dry_run,
        :patch,
        "/repos/#{path}/labels/#{escape_segment(old['name'])}",
        {
          new_name: desired_name,
          color: desired["color"],
          description: desired["description"]
        }
      )
      labels_by_name.delete(label_key(old["name"]))
      labels_by_name[desired_key] = desired
      counts[:renamed] += 1
      next
    end

    puts "#{dry_run ? 'WOULD CREATE' : 'CREATE'}     #{desired_name}"
    mutate(
      api,
      dry_run,
      :post,
      "/repos/#{path}/labels",
      {
        name: desired_name,
        color: desired["color"],
        description: desired["description"]
      }
    )
    labels_by_name[desired_key] = desired
    counts[:created] += 1
  end

  remaining = labels_by_name.values.reject { |label| desired_keys.include?(label_key(label["name"])) }
  stale_managed, repository_specific = remaining.partition { |label| managed_label?(label["name"], policy) }

  stale_managed.sort_by { |label| label["name"].downcase }.each do |label|
    name = label.fetch("name")
    puts "#{dry_run ? 'WOULD DELETE' : 'DELETE'}     stale organization label #{name}"
    mutate(api, dry_run, :delete, "/repos/#{path}/labels/#{escape_segment(name)}")
    counts[:deleted] += 1
  end

  repository_specific.sort_by { |label| label["name"].downcase }.each do |label|
    puts "PRESERVE        repository label #{label['name']}"
    counts[:preserved] += 1
  end

  puts "::endgroup::"
  counts
rescue StandardError
  puts "::endgroup::"
  raise
end

def write_summary(results, failures)
  summary_path = ENV["GITHUB_STEP_SUMMARY"]
  return if summary_path.to_s.empty?

  File.open(summary_path, "a", encoding: "UTF-8") do |summary|
    summary.puts "# 标签同步结果"
    summary.puts
    summary.puts "- 组织：`#{OWNER}`"
    summary.puts "- 标签配置：`#{CONFIG_FILE}`"
    summary.puts "- 同步策略：`#{POLICY_FILE}`"
    summary.puts "- Dry Run：`#{DRY_RUN}`"
    summary.puts "- 模式：组织级受管标签 + 仓库 Allowlist"
    summary.puts
    summary.puts "| 仓库 | 状态 | 新建 | 更新 | 重命名 | 删除 | 未变化 | 保留扩展 |"
    summary.puts "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"

    results.each do |result|
      summary.puts(
        "| `#{result[:repository]}` | #{result[:status]} | #{result[:created]} | " \
        "#{result[:updated]} | #{result[:renamed]} | #{result[:deleted]} | " \
        "#{result[:unchanged]} | #{result[:preserved]} |"
      )
    end

    unless failures.empty?
      summary.puts
      summary.puts "## 失败"
      summary.puts
      failures.each do |failure|
        message = failure[:error].gsub("\n", " ").gsub("|", "\\|")
        summary.puts "- `#{failure[:repository]}`：#{message}"
      end
    end
  end
end

def run
  raise "SYNC_LABELS_TOKEN 不能为空。" if TOKEN.empty?
  raise "SYNC_LABELS_OWNER 不能为空。" if OWNER.empty?

  desired_labels = load_labels(CONFIG_FILE)
  policy = load_policy(POLICY_FILE)
  validate_label_policy!(desired_labels, policy)

  api = GitHubApi.new(token: TOKEN, base_url: API_URL)
  repositories = load_repositories(api, OWNER, policy, ONLY_REPOSITORY)

  puts "Owner: #{OWNER}"
  puts "Config: #{CONFIG_FILE}"
  puts "Policy: #{POLICY_FILE}"
  puts "Dry run: #{DRY_RUN}"
  puts "Repositories: #{repositories.length}"
  puts

  results = []
  failures = []

  repositories.each do |repository|
    full_name = repository.fetch("full_name")

    begin
      counts = sync_repository(api, full_name, desired_labels, policy: policy, dry_run: DRY_RUN)
      results << {
        repository: full_name,
        status: DRY_RUN ? "预览完成" : "同步完成",
        **counts
      }
    rescue StandardError => error
      puts "::error title=标签同步失败::#{full_name}: #{error.message.lines.first.to_s.strip}"
      puts
      puts "Repository: #{full_name}"
      puts error.message
      puts

      results << {
        repository: full_name,
        status: "失败",
        created: 0,
        updated: 0,
        renamed: 0,
        deleted: 0,
        unchanged: 0,
        preserved: 0
      }
      failures << { repository: full_name, error: error.message }
    end
  end

  write_summary(results, failures)

  if failures.any?
    warn "#{failures.length} 个仓库同步失败。"
    exit 1
  end

  puts(DRY_RUN ? "Dry Run 完成。" : "标签同步完成。")
end

run if $PROGRAM_NAME == __FILE__
