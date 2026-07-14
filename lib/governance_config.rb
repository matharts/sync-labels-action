# frozen_string_literal: true

require "set"
require "uri"
require "yaml"

module SyncLabels
  module GovernanceInternals
    module_function

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
      raise "#{description} YAML 无效（#{path}）：#{error.message}"
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
  end

  class GovernanceConfig
    attr_reader :labels

    def self.load(labels_path:, policy_path:)
      labels = GovernanceInternals.load_labels(labels_path)
      policy = GovernanceInternals.load_policy(policy_path)
      build(labels: labels, policy: policy)
    end

    def self.build(labels:, policy:)
      GovernanceInternals.validate_label_policy!(labels, policy)
      new(labels: labels, policy: policy)
    end

    def initialize(labels:, policy:)
      @labels = labels
      @policy = policy
    end

    def repositories(api:, owner:, only_repository: "")
      GovernanceInternals.load_repositories(api, owner, @policy, only_repository)
    end

    def managed?(name)
      GovernanceInternals.managed_label?(name, @policy)
    end

    def repository_names
      @policy[:repositories]
    end
  end

  private_constant :GovernanceInternals
end
