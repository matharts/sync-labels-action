#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative "src/application"
require_relative "src/github_api"
require_relative "src/governance_config"
require_relative "src/repository_synchronizer"
require_relative "src/summary_writer"

TOKEN = ENV.fetch("SYNC_LABELS_TOKEN", "")
OWNER = ENV.fetch("SYNC_LABELS_OWNER", "")
CONFIG_FILE = ENV.fetch("SYNC_LABELS_CONFIG_FILE", ".github/labels.yml")
POLICY_FILE = ENV.fetch("SYNC_LABELS_POLICY_FILE", ".github/label-policy.yml")
ONLY_REPOSITORY = ENV.fetch("SYNC_LABELS_REPOSITORY", "").strip
API_URL = ENV.fetch("SYNC_LABELS_API_URL", "https://api.github.com").sub(%r{/\z}, "")
DRY_RUN = %w[1 true yes on].include?(ENV.fetch("SYNC_LABELS_DRY_RUN", "true").downcase)

def run
  raise "SYNC_LABELS_TOKEN 不能为空。" if TOKEN.empty?
  raise "SYNC_LABELS_OWNER 不能为空。" if OWNER.empty?

  config = SyncLabels::GovernanceConfig.load(labels_path: CONFIG_FILE, policy_path: POLICY_FILE)
  api = GitHubApi.new(token: TOKEN, base_url: API_URL)
  repositories = config.repositories(api: api, owner: OWNER, only_repository: ONLY_REPOSITORY)

  puts "Owner: #{OWNER}"
  puts "Config: #{CONFIG_FILE}"
  puts "Policy: #{POLICY_FILE}"
  puts "Dry run: #{DRY_RUN}"
  puts "Repositories: #{repositories.length}"
  puts

  synchronizer = SyncLabels::RepositorySynchronizer.new(
    api: api,
    config: config,
    dry_run: DRY_RUN
  )
  result = SyncLabels::Application.new(
    repositories: repositories,
    synchronizer: synchronizer,
    dry_run: DRY_RUN
  ).run

  SyncLabels::SummaryWriter.new(
    path: ENV["GITHUB_STEP_SUMMARY"],
    owner: OWNER,
    config_file: CONFIG_FILE,
    policy_file: POLICY_FILE,
    dry_run: DRY_RUN
  ).write(result)

  unless result.success?
    warn "#{result.failures.length} 个仓库同步失败。"
    return 1
  end

  puts(DRY_RUN ? "Dry Run 完成。" : "标签同步完成。")
  0
end

exit(run) if $PROGRAM_NAME == __FILE__
