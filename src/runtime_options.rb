# frozen_string_literal: true

module SyncLabels
  class RuntimeOptions
    attr_reader :token, :owner, :config_file, :policy_file, :only_repository, :api_url, :dry_run

    def self.load(env = ENV)
      new(
        token: env.fetch("SYNC_LABELS_TOKEN", ""),
        owner: env.fetch("SYNC_LABELS_OWNER", ""),
        config_file: env.fetch("SYNC_LABELS_CONFIG_FILE", ".github/labels.yml"),
        policy_file: env.fetch("SYNC_LABELS_POLICY_FILE", ".github/label-policy.yml"),
        only_repository: env.fetch("SYNC_LABELS_REPOSITORY", ""),
        api_url: env.fetch("SYNC_LABELS_API_URL", "https://api.github.com"),
        dry_run: env.fetch("SYNC_LABELS_DRY_RUN", "true")
      )
    end

    def initialize(token:, owner:, config_file:, policy_file:, only_repository:, api_url:, dry_run:)
      @token = token.to_s
      @owner = owner.to_s.strip
      @config_file = config_file.to_s
      @policy_file = policy_file.to_s
      @only_repository = only_repository.to_s.strip
      @api_url = api_url.to_s.strip.sub(%r{/\z}, "")
      @dry_run = parse_boolean("SYNC_LABELS_DRY_RUN", dry_run)

      raise "SYNC_LABELS_TOKEN 不能为空。" if @token.strip.empty?
      raise "SYNC_LABELS_OWNER 不能为空。" if @owner.empty?

      freeze
    end

    private

    def parse_boolean(name, value)
      case value.to_s.strip.downcase
      when "1", "true", "yes", "on"
        true
      when "0", "false", "no", "off"
        false
      else
        raise ArgumentError, "#{name} 必须是 true/false、1/0、yes/no 或 on/off。"
      end
    end

    private_class_method :new
  end
end
