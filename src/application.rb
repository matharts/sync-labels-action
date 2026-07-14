# frozen_string_literal: true

require_relative "sync_result"

module SyncLabels
  RunResult = Struct.new(:results, :failures, keyword_init: true) do
    def success?
      failures.empty?
    end

    def totals
      results.each_with_object(SyncResult.zero) do |result, aggregate|
        SyncResult.members.each do |field|
          aggregate[field] += result.counts[field]
        end
      end
    end
  end

  class Application
    def initialize(repositories:, synchronizer:, dry_run:, output: $stdout)
      @repositories = repositories
      @synchronizer = synchronizer
      @dry_run = dry_run
      @output = output
    end

    def run
      results = []
      failures = []

      @repositories.each do |repository|
        full_name = repository.fetch("full_name")

        begin
          counts = @synchronizer.sync(full_name)
          results << RepositoryOutcome.new(
            repository: full_name,
            status: @dry_run ? "预览完成" : "同步完成",
            counts: counts
          )
        rescue StandardError => error
          report_failure(full_name, error)
          counts = error.respond_to?(:counts) ? error.counts : SyncResult.zero
          results << RepositoryOutcome.new(repository: full_name, status: "失败", counts: counts)
          failures << { repository: full_name, error: error.message }
        end
      end

      RunResult.new(results: results, failures: failures)
    end

    private

    def report_failure(full_name, error)
      @output.puts "::error title=标签同步失败::#{full_name}: #{error.message.lines.first.to_s.strip}"
      @output.puts
      @output.puts "Repository: #{full_name}"
      @output.puts error.message
      @output.puts
    end
  end
end
