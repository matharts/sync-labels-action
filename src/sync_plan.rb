# frozen_string_literal: true

require "json"
require_relative "sync_result"

module SyncLabels
  PlanEntry = Struct.new(:action, :name, :desired, :reason, keyword_init: true) do
    def to_h
      value = {
        "action" => action.to_s,
        "name" => name
      }
      value["desired"] = desired unless desired.nil?
      value["reason"] = reason.to_s unless reason.nil?
      value
    end
  end

  class SyncPlan
    ACTION_COUNTS = {
      create: :created,
      update: :updated,
      rename: :renamed,
      delete: :deleted,
      unchanged: :unchanged,
      preserve: :preserved
    }.freeze
    ACTIONS_WITH_DESIRED = %i[create update rename].freeze
    DELETE_REASONS = %i[legacy_alias stale_managed].freeze

    attr_reader :entries, :counts

    def initialize(entries:)
      raise ArgumentError, "同步计划 entries 必须是数组。" unless entries.is_a?(Array)

      @entries = entries.map { |entry| validate_and_copy(entry) }.freeze
      @counts = @entries.each_with_object(SyncResult.zero) do |entry, result|
        result[ACTION_COUNTS.fetch(entry.action)] += 1
      end.freeze
      freeze
    end

    def to_h
      {
        "entries" => entries.map(&:to_h),
        "counts" => counts.to_h.transform_keys(&:to_s)
      }
    end

    def to_json(*arguments)
      to_h.to_json(*arguments)
    end

    private

    def validate_and_copy(entry)
      raise ArgumentError, "同步计划 entry 类型无效。" unless entry.is_a?(PlanEntry)
      raise ArgumentError, "未知同步计划操作：#{entry.action.inspect}" unless ACTION_COUNTS.key?(entry.action)
      unless entry.name.is_a?(String) && !entry.name.empty?
        raise ArgumentError, "同步计划操作缺少标签名称。"
      end

      validate_desired!(entry)
      validate_reason!(entry)

      PlanEntry.new(
        action: entry.action,
        name: immutable_copy(entry.name),
        desired: immutable_copy(entry.desired),
        reason: entry.reason
      ).freeze
    end

    def validate_desired!(entry)
      if ACTIONS_WITH_DESIRED.include?(entry.action)
        raise ArgumentError, "#{entry.action} 操作缺少目标标签。" unless entry.desired.is_a?(Hash)

        missing = %w[name color description].reject { |key| entry.desired.key?(key) }
        unless missing.empty?
          raise ArgumentError, "#{entry.action} 操作的目标标签缺少字段：#{missing.join(', ')}"
        end
      elsif !entry.desired.nil?
        raise ArgumentError, "#{entry.action} 操作不能包含目标标签。"
      end
    end

    def validate_reason!(entry)
      if entry.action == :delete
        unless DELETE_REASONS.include?(entry.reason)
          raise ArgumentError, "delete 操作的原因无效：#{entry.reason.inspect}"
        end
      elsif !entry.reason.nil?
        raise ArgumentError, "#{entry.action} 操作不能包含删除原因。"
      end
    end

    def immutable_copy(value)
      case value
      when Hash
        value.each_with_object({}) do |(key, item), copy|
          copy[immutable_copy(key)] = immutable_copy(item)
        end.freeze
      when Array
        value.map { |item| immutable_copy(item) }.freeze
      when String
        value.dup.freeze
      else
        value
      end
    end
  end
end
