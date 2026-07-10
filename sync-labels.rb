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
ONLY_REPOSITORY = ENV.fetch("SYNC_LABELS_REPOSITORY", "").strip
API_URL = ENV.fetch("SYNC_LABELS_API_URL", "https://api.github.com").sub(%r{/\z}, "")
DRY_RUN = %w[1 true yes on].include?(ENV.fetch("SYNC_LABELS_DRY_RUN", "true").downcase)

MANAGED_PREFIXES = %w[
  type:
  status:
  priority:
  impact:
  process:
  resolution:
].freeze

MANAGED_EXACT_NAMES = Set.new(
  [
    "good first issue",
    "help wanted"
  ]
).freeze

class GitHubApi
  def initialize(token:, base_url:)
    @token = token
    @base_url = base_url
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

    response = Net::HTTP.start(
      uri.hostname,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: 15,
      read_timeout: 60
    ) do |http|
      http.request(request)
    end

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

def load_labels(path)
  parsed = YAML.safe_load(
    File.read(path, encoding: "UTF-8"),
    permitted_classes: [],
    permitted_symbols: [],
    aliases: false
  )

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
rescue Errno::ENOENT
  raise "找不到标签配置文件：#{path}"
rescue Psych::SyntaxError => error
  raise "标签配置 YAML 无效：#{error.message}"
end

def managed_label?(name, alias_keys)
  key = label_key(name)
  MANAGED_PREFIXES.any? { |prefix| key.start_with?(prefix) } ||
    MANAGED_EXACT_NAMES.include?(key) ||
    alias_keys.include?(key)
end

def mutate(api, dry_run, method, *arguments)
  api.public_send(method, *arguments) unless dry_run
end

def sync_repository(api, full_name, desired_labels, dry_run:)
  path = repository_path(full_name)
  existing = api.paginate("/repos/#{path}/labels")
  labels_by_name = existing.to_h { |label| [label_key(label["name"]), label] }

  desired_keys = desired_labels.map { |label| label_key(label["name"]) }.to_set
  alias_keys = desired_labels.flat_map { |label| label["aliases"] }.map { |name| label_key(name) }.to_set

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
    alias_matches = desired["aliases"].filter_map { |alias_name| labels_by_name[label_key(alias_name)] }
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
  stale_managed, repository_specific = remaining.partition do |label|
    managed_label?(label["name"], alias_keys)
  end

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
    summary.puts "- 配置：`#{CONFIG_FILE}`"
    summary.puts "- Dry Run：`#{DRY_RUN}`"
    summary.puts "- 模式：组织级标签受管子集"
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
  api = GitHubApi.new(token: TOKEN, base_url: API_URL)
  repositories = api.paginate(
    "/orgs/#{escape_segment(OWNER)}/repos?type=all&sort=full_name&direction=asc"
  ).select do |repository|
    !repository["archived"] && !repository["disabled"] && !repository["fork"]
  end

  unless ONLY_REPOSITORY.empty?
    expected = ONLY_REPOSITORY.include?("/") ? ONLY_REPOSITORY : "#{OWNER}/#{ONLY_REPOSITORY}"
    repositories.select! { |repository| repository["full_name"].casecmp(expected).zero? }
    if repositories.empty?
      raise "找不到可同步仓库 #{expected}。请检查名称、令牌访问范围和仓库状态。"
    end
  end

  puts "Owner: #{OWNER}"
  puts "Config: #{CONFIG_FILE}"
  puts "Dry run: #{DRY_RUN}"
  puts "Repositories: #{repositories.length}"
  puts

  results = []
  failures = []

  repositories.each do |repository|
    full_name = repository.fetch("full_name")

    begin
      counts = sync_repository(api, full_name, desired_labels, dry_run: DRY_RUN)
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
