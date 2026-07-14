# frozen_string_literal: true

module SyncLabels
  class SummaryWriter
    def initialize(path:, owner:, config_file:, policy_file:, dry_run:)
      @path = path
      @owner = owner
      @config_file = config_file
      @policy_file = policy_file
      @dry_run = dry_run
    end

    def write(run_result)
      return if @path.to_s.empty?

      File.open(@path, "a", encoding: "UTF-8") do |summary|
        write_header(summary)
        write_results(summary, run_result.results)
        write_failures(summary, run_result.failures)
      end
    end

    private

    def write_header(summary)
      summary.puts "# 标签同步结果"
      summary.puts
      summary.puts "- 组织：`#{@owner}`"
      summary.puts "- 标签配置：`#{@config_file}`"
      summary.puts "- 同步策略：`#{@policy_file}`"
      summary.puts "- Dry Run：`#{@dry_run}`"
      summary.puts "- 模式：组织级受管标签 + 仓库 Allowlist"
      summary.puts
    end

    def write_results(summary, results)
      summary.puts "| 仓库 | 状态 | 新建 | 更新 | 重命名 | 删除 | 未变化 | 保留扩展 |"
      summary.puts "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"

      results.each do |result|
        summary.puts(
          "| `#{result[:repository]}` | #{result[:status]} | #{result[:created]} | " \
          "#{result[:updated]} | #{result[:renamed]} | #{result[:deleted]} | " \
          "#{result[:unchanged]} | #{result[:preserved]} |"
        )
      end
    end

    def write_failures(summary, failures)
      return if failures.empty?

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
