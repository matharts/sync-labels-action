# frozen_string_literal: true

require_relative "label_identity"
require_relative "sync_executor"
require_relative "sync_planner"

module SyncLabels
  class RepositorySynchronizer
    def initialize(api:, config:, dry_run:, output: $stdout)
      @api = api
      @output = output
      @planner = SyncPlanner.new(config: config)
      @executor = SyncExecutor.new(api: api, dry_run: dry_run, output: output)
    end

    def sync(full_name)
      counts = SyncResult.zero
      @output.puts "::group::#{full_name}"
      path = LabelIdentity.repository_path(full_name)
      existing = @api.paginate("/repos/#{path}/labels")
      plan = @planner.plan(existing)
      @executor.apply(full_name, plan)
    rescue RepositorySyncError
      raise
    rescue StandardError => error
      raise RepositorySyncError.new(error.message, counts: counts), cause: error
    ensure
      @output.puts "::endgroup::"
    end
  end
end
