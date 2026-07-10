# frozen_string_literal: true

require "minitest/autorun"
require_relative "sync-labels"

class FakeApi
  attr_reader :calls

  def initialize(labels)
    @labels = labels
    @calls = []
  end

  def paginate(_path)
    @labels.map(&:dup)
  end

  def patch(path, body)
    @calls << [:patch, path, body]
  end

  def post(path, body)
    @calls << [:post, path, body]
  end

  def delete(path)
    @calls << [:delete, path]
  end
end

class SyncLabelsTest < Minitest::Test
  DESIRED = [
    {
      "name" => "type: bug",
      "color" => "D73A4A",
      "description" => "已有行为出现错误、缺陷或回归",
      "aliases" => ["bug"]
    },
    {
      "name" => "type: feature",
      "color" => "A2EEEF",
      "description" => "新增能力或改进现有功能",
      "aliases" => ["enhancement"]
    },
    {
      "name" => "help wanted",
      "color" => "008672",
      "description" => "维护者明确欢迎并能够评审外部贡献",
      "aliases" => []
    }
  ].freeze

  def test_preserves_repository_specific_labels_and_removes_stale_managed_labels
    api = FakeApi.new(
      [
        { "name" => "bug", "color" => "FFFFFF", "description" => "legacy" },
        { "name" => "type: feature", "color" => "A2EEEF", "description" => "新增能力或改进现有功能" },
        { "name" => "enhancement", "color" => "FFFFFF", "description" => "legacy duplicate" },
        { "name" => "type: obsolete", "color" => "000000", "description" => "stale" },
        { "name" => "area: ephemeris", "color" => "123456", "description" => "repository extension" },
        { "name" => "package: core", "color" => "123456", "description" => "repository extension" },
        { "name" => "custom", "color" => "123456", "description" => "repository extension" }
      ]
    )

    counts = sync_repository(api, "matharts/example", DESIRED, dry_run: false)

    assert_equal 1, counts[:created]
    assert_equal 0, counts[:updated]
    assert_equal 1, counts[:renamed]
    assert_equal 2, counts[:deleted]
    assert_equal 1, counts[:unchanged]
    assert_equal 3, counts[:preserved]

    deleted_paths = api.calls.filter_map { |call| call[1] if call.first == :delete }
    assert_includes deleted_paths, "/repos/matharts/example/labels/enhancement"
    assert_includes deleted_paths, "/repos/matharts/example/labels/type%3A%20obsolete"
    refute deleted_paths.any? { |path| path.include?("area%3A%20ephemeris") }
    refute deleted_paths.any? { |path| path.include?("package%3A%20core") }
  end

  def test_dry_run_does_not_mutate
    api = FakeApi.new(
      [
        { "name" => "bug", "color" => "FFFFFF", "description" => "legacy" },
        { "name" => "area: calendar", "color" => "123456", "description" => "repository extension" }
      ]
    )

    counts = sync_repository(api, "matharts/example", DESIRED, dry_run: true)

    assert_empty api.calls
    assert_equal 1, counts[:renamed]
    assert_equal 2, counts[:created]
    assert_equal 1, counts[:preserved]
  end
end
