#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative "src/application"
require_relative "src/github_api"
require_relative "src/github_output_writer"
require_relative "src/governance_config"
require_relative "src/repository_synchronizer"
require_relative "src/runtime_options"
require_relative "src/summary_writer"
require_relative "src/sync_executor"
require_relative "src/sync_planner"

def run(env: ENV)
  options = SyncLabels::RuntimeOptions.load(env)
  config = SyncLabels::GovernanceConfig.load(
    labels_path: options.config_file,
    policy_path: options.policy_file
  )
  api = GitHubApi.new(token: options.token, base_url: options.api_url)
  repositories = config.repositories(
    api: api,
    owner: options.owner,
    only_repository: options.only_repository
  )

  puts "Owner: #{options.owner}"
  puts "Config: #{options.config_file}"
  puts "Policy: #{options.policy_file}"
  puts "Dry run: #{options.dry_run}"
  puts "Repositories: #{repositories.length}"
  puts

  synchronizer = SyncLabels::RepositorySynchronizer.new(
    api: api,
    config: config,
    dry_run: options.dry_run
  )
  result = SyncLabels::Application.new(
    repositories: repositories,
    synchronizer: synchronizer,
    dry_run: options.dry_run
  ).run

  SyncLabels::SummaryWriter.new(
    path: env["GITHUB_STEP_SUMMARY"],
    owner: options.owner,
    config_file: options.config_file,
    policy_file: options.policy_file,
    dry_run: options.dry_run
  ).write(result)
  SyncLabels::GitHubOutputWriter.new(path: env["GITHUB_OUTPUT"]).write(result)

  unless result.success?
    warn "#{result.failures.length} 个仓库同步失败。"
    return 1
  end

  puts(options.dry_run ? "Dry Run 完成。" : "标签同步完成。")
  0
end

exit(run) if $PROGRAM_NAME == __FILE__
