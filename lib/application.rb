# frozen_string_literal: true

module SyncLabels
  RunResult = Struct.new(:results, :failures, keyword_init: true) do
    def success?
      failures.empty?
    end
  end

  class Application
    EMPTY_COUNTS = {
      created: 0,
      updated: 0,
      renamed: 0,
      deleted: 0,
      unchanged: 0,
      preserved: 0
    }.freeze

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
          results << {
            repository: full_name,
            status: @dry_run ? "预览完成" : "同步完成",
            **counts
          }
        rescue StandardError => error
          report_failure(full_name, error)
          results << { repository: full_name, status: "失败", **EMPTY_COUNTS }
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
