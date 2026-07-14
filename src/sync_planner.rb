# frozen_string_literal: true

require "set"
require_relative "label_identity"
require_relative "sync_plan"

module SyncLabels
  class SyncPlanner
    def initialize(config:)
      @config = config
    end

    def plan(existing)
      entries = []
      labels_by_name = existing.to_h { |label| [LabelIdentity.key(label["name"]), label] }
      desired_keys = @config.labels.map { |label| LabelIdentity.key(label["name"]) }.to_set

      @config.labels.each do |desired|
        desired_name = desired["name"]
        desired_key = LabelIdentity.key(desired_name)
        current = labels_by_name[desired_key]
        alias_matches = desired["aliases"].map { |name| labels_by_name[LabelIdentity.key(name)] }.compact
          .uniq { |label| LabelIdentity.key(label["name"]) }

        if current
          action = label_changed?(current, desired) ? :update : :unchanged
          entries << entry(action, current.fetch("name"), desired: action == :update ? desired : nil)
          labels_by_name.delete(LabelIdentity.key(current["name"]))
          labels_by_name[desired_key] = desired

          alias_matches.each do |legacy|
            entries << entry(:delete, legacy.fetch("name"), reason: :legacy_alias)
            labels_by_name.delete(LabelIdentity.key(legacy["name"]))
          end
          next
        end

        if alias_matches.length > 1
          names = alias_matches.map { |label| label["name"] }.join(", ")
          raise "多个旧标签同时映射到 #{desired_name}：#{names}"
        end

        if alias_matches.length == 1
          old = alias_matches.first
          entries << entry(:rename, old.fetch("name"), desired: desired)
          labels_by_name.delete(LabelIdentity.key(old["name"]))
          labels_by_name[desired_key] = desired
          next
        end

        entries << entry(:create, desired_name, desired: desired)
        labels_by_name[desired_key] = desired
      end

      remaining = labels_by_name.values.reject { |label| desired_keys.include?(LabelIdentity.key(label["name"])) }
      stale_managed, repository_specific = remaining.partition { |label| @config.managed?(label["name"]) }

      stale_managed.sort_by { |label| label["name"].downcase }.each do |label|
        entries << entry(:delete, label.fetch("name"), reason: :stale_managed)
      end
      repository_specific.sort_by { |label| label["name"].downcase }.each do |label|
        entries << entry(:preserve, label.fetch("name"))
      end

      SyncPlan.new(entries: entries)
    end

    private

    def label_changed?(current, desired)
      current["name"] != desired["name"] ||
        current["color"].to_s.upcase != desired["color"] ||
        current["description"].to_s != desired["description"]
    end

    def entry(action, name, desired: nil, reason: nil)
      PlanEntry.new(action: action, name: name, desired: desired, reason: reason)
    end
  end
end
