# frozen_string_literal: true

module SyncLabels
  class GitHubOutputWriter
    def initialize(path:)
      @path = path
    end

    def write(run_result)
      return if @path.to_s.empty?

      totals = run_result.totals
      values = {
        repositories: run_result.results.length,
        changed: totals.changed?,
        created: totals.created,
        updated: totals.updated,
        renamed: totals.renamed,
        deleted: totals.deleted,
        unchanged: totals.unchanged,
        preserved: totals.preserved,
        failures: run_result.failures.length
      }

      File.open(@path, "a", encoding: "UTF-8") do |output|
        values.each { |name, value| output.puts "#{name}=#{value}" }
      end
    end
  end
end
