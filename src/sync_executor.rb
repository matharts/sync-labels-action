# frozen_string_literal: true

require_relative "label_identity"
require_relative "sync_plan"

module SyncLabels
  class SyncExecutor
    def initialize(api:, dry_run:, output: $stdout)
      @api = api
      @dry_run = dry_run
      @output = output
    end

    def apply(full_name, plan)
      raise ArgumentError, "apply 需要已验证的 SyncPlan。" unless plan.is_a?(SyncPlan)

      counts = SyncResult.zero
      path = LabelIdentity.repository_path(full_name)

      plan.entries.each do |entry|
        apply_entry(path, entry)
        counts[SyncPlan::ACTION_COUNTS.fetch(entry.action)] += 1
      end

      counts
    rescue RepositorySyncError
      raise
    rescue StandardError => error
      raise RepositorySyncError.new(error.message, counts: counts), cause: error
    end

    private

    def apply_entry(path, entry)
      case entry.action
      when :create
        @output.puts "#{prefix('CREATE')}     #{entry.name}"
        mutate(:post, "/repos/#{path}/labels", label_payload(entry.desired, include_name: true))
      when :update, :rename
        @output.puts "#{prefix(entry.action.to_s.upcase)}     #{entry.name} -> #{entry.desired.fetch('name')}"
        mutate(:patch, label_path(path, entry.name), label_payload(entry.desired, include_name: false))
      when :delete
        description = entry.reason == :legacy_alias ? "legacy alias #{entry.name}" : "stale organization label #{entry.name}"
        @output.puts "#{prefix('DELETE')}     #{description}"
        mutate(:delete, label_path(path, entry.name))
      when :unchanged
        @output.puts "UNCHANGED       #{entry.name}"
      when :preserve
        @output.puts "PRESERVE        repository label #{entry.name}"
      else
        raise "未知同步计划操作：#{entry.action.inspect}"
      end
    end

    def prefix(action)
      @dry_run ? "WOULD #{action}" : action
    end

    def label_path(repository_path, name)
      "/repos/#{repository_path}/labels/#{LabelIdentity.escape(name)}"
    end

    def label_payload(desired, include_name:)
      payload = {
        color: desired.fetch("color"),
        description: desired.fetch("description")
      }
      payload[include_name ? :name : :new_name] = desired.fetch("name")
      payload
    end

    def mutate(method, *arguments)
      @api.public_send(method, *arguments) unless @dry_run
    end
  end
end
