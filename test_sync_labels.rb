# frozen_string_literal: true

require "minitest/autorun"
require_relative "sync-labels"

class FakeApi
  attr_reader :calls

  def initialize(labels: [], repositories: {})
    @labels = labels
    @repositories = repositories
    @calls = []
  end

  def get(path)
    @calls << [:get, path]
    @repositories.fetch(path)
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

  POLICY = {
    prefixes: ["type:"].freeze,
    exact_names: Set.new(["help wanted"]).freeze,
    legacy_names: Set.new(%w[bug enhancement]).freeze,
    repositories: %w[example docs].freeze
  }.freeze

  def test_preserves_repository_specific_labels_and_removes_stale_managed_labels
    api = FakeApi.new(
      labels: [
        { "name" => "bug", "color" => "FFFFFF", "description" => "legacy" },
        { "name" => "type: feature", "color" => "A2EEEF", "description" => "新增能力或改进现有功能" },
        { "name" => "enhancement", "color" => "FFFFFF", "description" => "legacy duplicate" },
        { "name" => "type: obsolete", "color" => "000000", "description" => "stale" },
        { "name" => "area: ephemeris", "color" => "123456", "description" => "repository extension" },
        { "name" => "package: core", "color" => "123456", "description" => "repository extension" },
        { "name" => "custom", "color" => "123456", "description" => "repository extension" }
      ]
    )

    counts = sync_repository(api, "matharts/example", DESIRED, policy: POLICY, dry_run: false)

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
      labels: [
        { "name" => "bug", "color" => "FFFFFF", "description" => "legacy" },
        { "name" => "area: calendar", "color" => "123456", "description" => "repository extension" }
      ]
    )

    counts = sync_repository(api, "matharts/example", DESIRED, policy: POLICY, dry_run: true)

    assert_empty api.calls
    assert_equal 1, counts[:renamed]
    assert_equal 2, counts[:created]
    assert_equal 1, counts[:preserved]
  end

  def test_rejects_repository_outside_allowlist
    api = FakeApi.new

    error = assert_raises(RuntimeError) do
      load_repositories(api, "matharts", POLICY, "private-project")
    end

    assert_includes error.message, "不在标签同步 Allowlist"
    assert_empty api.calls
  end

  def test_loads_only_allowlisted_repositories
    api = FakeApi.new(
      repositories: {
        "/repos/matharts/example" => {
          "full_name" => "matharts/example",
          "archived" => false,
          "disabled" => false,
          "fork" => false
        },
        "/repos/matharts/docs" => {
          "full_name" => "matharts/docs",
          "archived" => false,
          "disabled" => false,
          "fork" => false
        }
      }
    )

    repositories = load_repositories(api, "matharts", POLICY, "")

    assert_equal %w[matharts/example matharts/docs], repositories.map { |repository| repository["full_name"] }
    assert_equal [
      [:get, "/repos/matharts/example"],
      [:get, "/repos/matharts/docs"]
    ], api.calls
  end

  def test_policy_requires_aliases_to_remain_owned_as_legacy_names
    policy = POLICY.merge(legacy_names: Set.new(["bug"]).freeze)

    error = assert_raises(RuntimeError) do
      validate_label_policy!(DESIRED, policy)
    end

    assert_includes error.message, "enhancement"
  end

  def test_repository_policy_matches_current_configuration
    root = File.expand_path("../../..", __dir__)
    labels = load_labels(File.join(root, ".github/labels.yml"))
    policy = load_policy(File.join(root, ".github/label-policy.yml"))

    validate_label_policy!(labels, policy)
    assert_equal %w[.github ecosystem epheon matharts skills ziwei], policy[:repositories]
  end
end
