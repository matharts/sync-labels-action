# frozen_string_literal: true

require "minitest/autorun"
require "open3"
require "rbconfig"
require "stringio"
require "tmpdir"
require_relative "sync-labels"

class FakeApi
  attr_reader :calls

  def initialize(labels: [], repositories: {}, organization_repositories: nil)
    @labels = labels
    @repositories = repositories
    @organization_repositories = organization_repositories
    @calls = []
  end

  def get(path)
    @calls << [:get, path]
    @repositories.fetch(path)
  end

  def paginate(path)
    unless @organization_repositories.nil?
      @calls << [:paginate, path]
      return @organization_repositories.map(&:dup)
    end

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

FakeResponse = Struct.new(:code, :body, :headers) do
  def [](name)
    headers.fetch(name.downcase, "")
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

  def governance_config(labels: DESIRED, policy: POLICY)
    SyncLabels::GovernanceConfig.build(labels: labels, policy: policy)
  end

  def repository_synchronizer(api, dry_run:)
    SyncLabels::RepositorySynchronizer.new(
      api: api,
      config: governance_config,
      dry_run: dry_run,
      output: StringIO.new
    )
  end

  def runtime_options(overrides = {})
    SyncLabels::RuntimeOptions.load(
      {
        "SYNC_LABELS_TOKEN" => "test-token",
        "SYNC_LABELS_OWNER" => "matharts"
      }.merge(overrides)
    )
  end

  def load_governance_config(policy_document)
    Dir.mktmpdir do |directory|
      labels_path = File.join(directory, "labels.yml")
      policy_path = File.join(directory, "label-policy.yml")
      File.write(labels_path, YAML.dump(DESIRED))
      File.write(policy_path, YAML.dump(policy_document))
      return SyncLabels::GovernanceConfig.load(labels_path: labels_path, policy_path: policy_path)
    end
  end

  def policy_document
    {
      "version" => 1,
      "managed" => {
        "prefixes" => ["type:"],
        "exact_names" => ["help wanted"],
        "legacy_names" => %w[bug enhancement]
      }
    }
  end

  def test_repository_synchronizer_loads_independently
    script = <<~RUBY
      require #{File.expand_path("src/repository_synchronizer", __dir__).inspect}
      abort "GovernanceConfig was loaded" if defined?(SyncLabels::GovernanceConfig)
      abort "Set was not loaded" unless defined?(Set)
    RUBY

    _output, error, status = Open3.capture3(RbConfig.ruby, "-e", script)

    assert status.success?, error
  end

  def test_dry_run_input_accepts_explicit_boolean_values
    {
      "true" => true,
      "1" => true,
      "yes" => true,
      "on" => true,
      "false" => false,
      "0" => false,
      "no" => false,
      "off" => false
    }.each do |input, expected|
      assert_equal expected, runtime_options("SYNC_LABELS_DRY_RUN" => input).dry_run
    end
  end

  def test_dry_run_input_rejects_unknown_values
    ["treu", "", "write"].each do |input|
      error = assert_raises(ArgumentError) do
        runtime_options("SYNC_LABELS_DRY_RUN" => input)
      end

      assert_includes error.message, "SYNC_LABELS_DRY_RUN 必须是 true/false、1/0、yes/no 或 on/off。"
    end
  end

  def test_runtime_options_validate_required_inputs_and_defaults
    token_error = assert_raises(RuntimeError) do
      runtime_options("SYNC_LABELS_TOKEN" => "")
    end
    owner_error = assert_raises(RuntimeError) do
      runtime_options("SYNC_LABELS_OWNER" => "")
    end

    assert_equal "SYNC_LABELS_TOKEN 不能为空。", token_error.message
    assert_equal "SYNC_LABELS_OWNER 不能为空。", owner_error.message

    options = runtime_options
    assert_equal "test-token", options.token
    assert_equal "matharts", options.owner
    assert_equal ".github/labels.yml", options.config_file
    assert_equal ".github/label-policy.yml", options.policy_file
    assert_equal "", options.only_repository
    assert_equal "https://api.github.com", options.api_url
    assert options.dry_run
  end

  def test_application_continues_after_one_repository_fails
    config = Struct.new(:repositories).new([
      { "full_name" => "matharts/failing" },
      { "full_name" => "matharts/healthy" }
    ])
    synchronizer = Object.new
    synchronizer.define_singleton_method(:sync) do |full_name|
      if full_name.end_with?("failing")
        raise SyncLabels::RepositorySyncError.new(
          "simulated failure",
          counts: SyncLabels::SyncResult.new(
            created: 1,
            updated: 0,
            renamed: 0,
            deleted: 0,
            unchanged: 0,
            preserved: 0
          )
        )
      end

      SyncLabels::SyncResult.new(
        created: 1,
        updated: 0,
        renamed: 0,
        deleted: 0,
        unchanged: 0,
        preserved: 0
      )
    end
    output = StringIO.new
    application = SyncLabels::Application.new(
      repositories: config.repositories,
      synchronizer: synchronizer,
      dry_run: true,
      output: output
    )

    result = application.run

    refute result.success?
    assert_equal ["matharts/failing"], result.failures.map { |failure| failure[:repository] }
    assert_equal %w[matharts/failing matharts/healthy], result.results.map(&:repository)
    assert_equal 1, result.results.first.counts.created
    assert_equal 2, result.totals.created
    assert_includes output.string, "matharts/failing"
    assert_includes output.string, "simulated failure"
  end

  def test_repository_synchronizer_reports_changes_completed_before_a_failure
    api = FakeApi.new(labels: [])
    mutation_count = 0
    api.define_singleton_method(:post) do |path, body|
      calls << [:post, path, body]
      mutation_count += 1
      raise "second mutation failed" if mutation_count == 2
    end
    output = StringIO.new
    synchronizer = SyncLabels::RepositorySynchronizer.new(
      api: api,
      config: governance_config,
      dry_run: false,
      output: output
    )

    error = assert_raises(SyncLabels::RepositorySyncError) do
      synchronizer.sync("matharts/example")
    end

    assert_equal "second mutation failed", error.message
    assert_equal 1, error.counts.created
    assert_equal 1, output.string.scan("::group::matharts/example").length
    assert_equal 1, output.string.scan("::endgroup::").length
  end

  def test_summary_writer_reports_and_escapes_failures
    Dir.mktmpdir do |directory|
      path = File.join(directory, "summary.md")
      result = SyncLabels::RunResult.new(
        results: [
          SyncLabels::RepositoryOutcome.new(
            repository: "matharts/example",
            status: "失败",
            counts: SyncLabels::SyncResult.zero
          )
        ],
        failures: [{ repository: "matharts/example", error: "bad | input\nsecond line" }]
      )
      writer = SyncLabels::SummaryWriter.new(
        path: path,
        owner: "matharts",
        config_file: "labels.yml",
        policy_file: "policy.yml",
        dry_run: true
      )

      writer.write(result)
      summary = File.read(path, encoding: "UTF-8")

      assert_includes summary, "`matharts/example`"
      assert_includes summary, "bad \\| input second line"
      assert_includes summary, "Dry Run：`true`"
      assert_includes summary, "模式：组织级受管标签"
      refute_includes summary, "Allowlist"
    end
  end

  def test_github_output_writer_exposes_aggregate_results
    Dir.mktmpdir do |directory|
      path = File.join(directory, "github-output")
      result = SyncLabels::RunResult.new(
        results: [
          SyncLabels::RepositoryOutcome.new(
            repository: "matharts/example",
            status: "同步完成",
            counts: SyncLabels::SyncResult.new(
              created: 1,
              updated: 2,
              renamed: 0,
              deleted: 1,
              unchanged: 3,
              preserved: 4
            )
          ),
          SyncLabels::RepositoryOutcome.new(
            repository: "matharts/docs",
            status: "同步完成",
            counts: SyncLabels::SyncResult.new(
              created: 2,
              updated: 0,
              renamed: 1,
              deleted: 0,
              unchanged: 1,
              preserved: 0
            )
          ),
          SyncLabels::RepositoryOutcome.new(
            repository: "matharts/failing",
            status: "失败",
            counts: SyncLabels::SyncResult.zero
          )
        ],
        failures: [{ repository: "matharts/failing", error: "simulated failure" }]
      )

      SyncLabels::GitHubOutputWriter.new(path: path).write(result)
      outputs = File.readlines(path, chomp: true).to_h { |line| line.split("=", 2) }

      assert_equal "3", outputs.fetch("repositories")
      assert_equal "true", outputs.fetch("changed")
      assert_equal "3", outputs.fetch("created")
      assert_equal "2", outputs.fetch("updated")
      assert_equal "1", outputs.fetch("renamed")
      assert_equal "1", outputs.fetch("deleted")
      assert_equal "4", outputs.fetch("unchanged")
      assert_equal "4", outputs.fetch("preserved")
      assert_equal "1", outputs.fetch("failures")
      refute SyncLabels::SyncResult.zero.changed?
    end
  end

  def test_github_output_writer_reports_no_drift
    Dir.mktmpdir do |directory|
      path = File.join(directory, "github-output")
      result = SyncLabels::RunResult.new(
        results: [
          SyncLabels::RepositoryOutcome.new(
            repository: "matharts/example",
            status: "预览完成",
            counts: SyncLabels::SyncResult.zero
          )
        ],
        failures: []
      )

      SyncLabels::GitHubOutputWriter.new(path: path).write(result)

      assert_includes File.readlines(path, chomp: true), "changed=false"
    end
  end

  def test_action_metadata_maps_all_declared_outputs_to_the_sync_step
    metadata = YAML.safe_load(File.read(File.expand_path("action.yml", __dir__)))
    output_names = %w[changed repositories created updated renamed deleted unchanged preserved failures]
    sync_step = metadata.fetch("runs").fetch("steps").find { |step| step["id"] == "sync" }

    refute_nil sync_step
    assert_equal output_names.sort, metadata.fetch("outputs").keys.sort
    output_names.each do |name|
      assert_equal "${{ steps.sync.outputs.#{name} }}", metadata.dig("outputs", name, "value")
    end
  end

  def test_github_api_requires_https
    error = assert_raises(ArgumentError) do
      GitHubApi.new(token: "token", base_url: "http://api.example.test")
    end

    assert_includes error.message, "HTTPS"
  end

  def test_github_api_retries_transient_server_errors
    responses = [
      FakeResponse.new("503", '{"message":"temporarily unavailable"}', { "retry-after" => "0" }),
      FakeResponse.new("200", '{"ok":true}', {})
    ]
    delays = []
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: ->(_uri, _request) { responses.shift },
      sleeper: ->(delay) { delays << delay },
      max_retries: 2
    )

    assert_equal({ "ok" => true }, api.get("/status"))
    assert_equal [0], delays
    assert_empty responses
  end

  def test_github_api_retries_rate_limit_responses
    responses = [
      FakeResponse.new(
        "403",
        '{"message":"rate limit exceeded"}',
        { "retry-after" => "0", "x-ratelimit-remaining" => "0" }
      ),
      FakeResponse.new("200", "[]", {})
    ]
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: ->(_uri, _request) { responses.shift },
      sleeper: ->(_delay) {},
      max_retries: 1
    )

    assert_equal [], api.get("/items")
    assert_empty responses
  end

  def test_github_api_retries_too_many_requests
    responses = [
      FakeResponse.new("429", '{"message":"slow down"}', { "retry-after" => "0" }),
      FakeResponse.new("200", "[]", {})
    ]
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: ->(_uri, _request) { responses.shift },
      sleeper: ->(_delay) {},
      max_retries: 1
    )

    assert_equal [], api.get("/items")
    assert_empty responses
  end

  def test_github_api_does_not_treat_reset_metadata_as_rate_limit
    attempts = 0
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: lambda do |_uri, _request|
        attempts += 1
        FakeResponse.new(
          "403",
          '{"message":"resource not accessible"}',
          { "x-ratelimit-remaining" => "4999", "x-ratelimit-reset" => "4102444800" }
        )
      end,
      sleeper: ->(_delay) { flunk "ordinary 403 must not be retried" }
    )

    error = assert_raises(RuntimeError) { api.get("/status") }
    assert_includes error.message, "Status: 403"
    assert_equal 1, attempts
  end

  def test_github_api_paginates_until_a_short_page
    paths = []
    pages = [[*1..100], [101]]
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: lambda do |_uri, request|
        paths << request.path
        FakeResponse.new("200", JSON.generate(pages.shift), {})
      end,
      sleeper: ->(_delay) {}
    )

    assert_equal [*1..101], api.paginate("/items?state=open")
    assert_equal [
      "/items?state=open&per_page=100&page=1",
      "/items?state=open&per_page=100&page=2"
    ], paths
    assert_empty pages
  end

  def test_github_api_retries_network_errors_for_get_requests
    attempts = 0
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: lambda do |_uri, _request|
        attempts += 1
        raise Net::ReadTimeout if attempts == 1

        FakeResponse.new("200", '{"ok":true}', {})
      end,
      sleeper: ->(_delay) {},
      max_retries: 1
    )

    assert_equal({ "ok" => true }, api.get("/status"))
    assert_equal 2, attempts
  end

  def test_github_api_does_not_retry_mutating_requests
    attempts = 0
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: lambda do |_uri, _request|
        attempts += 1
        raise Net::ReadTimeout
      end,
      sleeper: ->(_delay) { flunk "mutation must not be retried" },
      max_retries: 3
    )

    assert_raises(Net::ReadTimeout) { api.post("/labels", { name: "bug" }) }
    assert_equal 1, attempts
  end

  def test_github_api_does_not_retry_regular_client_errors
    attempts = 0
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: lambda do |_uri, _request|
        attempts += 1
        FakeResponse.new("401", '{"message":"bad credentials"}', {})
      end,
      sleeper: ->(_delay) { flunk "401 must not be retried" }
    )

    error = assert_raises(RuntimeError) { api.get("/status") }
    assert_includes error.message, "Status: 401"
    assert_equal 1, attempts
  end

  def test_github_api_stops_after_retry_limit
    attempts = 0
    api = GitHubApi.new(
      token: "token",
      base_url: "https://api.example.test",
      requester: lambda do |_uri, _request|
        attempts += 1
        FakeResponse.new("503", '{"message":"unavailable"}', { "retry-after" => "0" })
      end,
      sleeper: ->(_delay) {},
      max_retries: 2
    )

    error = assert_raises(RuntimeError) { api.get("/status") }
    assert_includes error.message, "Status: 503"
    assert_equal 3, attempts
  end

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

    counts = repository_synchronizer(api, dry_run: false).sync("matharts/example")

    assert_equal 1, counts[:created]
    assert_equal 0, counts[:updated]
    assert_equal 1, counts[:renamed]
    assert_equal 2, counts[:deleted]
    assert_equal 1, counts[:unchanged]
    assert_equal 3, counts[:preserved]

    deleted_paths = api.calls.map { |call| call[1] if call.first == :delete }.compact
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

    counts = repository_synchronizer(api, dry_run: true).sync("matharts/example")

    assert_empty api.calls
    assert_equal 1, counts[:renamed]
    assert_equal 2, counts[:created]
    assert_equal 1, counts[:preserved]
  end

  def test_rejects_repository_outside_allowlist
    api = FakeApi.new

    error = assert_raises(RuntimeError) do
      governance_config.repositories(api: api, owner: "matharts", only_repository: "private-project")
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

    repositories = governance_config.repositories(api: api, owner: "matharts")

    assert_equal %w[matharts/example matharts/docs], repositories.map { |repository| repository["full_name"] }
    assert_equal [
      [:get, "/repos/matharts/example"],
      [:get, "/repos/matharts/docs"]
    ], api.calls
  end

  def test_loads_all_eligible_organization_repositories_without_an_allowlist
    policy = POLICY.reject { |key, _value| key == :repositories }
    api = FakeApi.new(
      organization_repositories: [
        { "full_name" => "matharts/active", "archived" => false, "disabled" => false, "fork" => false },
        { "full_name" => "matharts/archived", "archived" => true, "disabled" => false, "fork" => false },
        { "full_name" => "matharts/disabled", "archived" => false, "disabled" => true, "fork" => false },
        { "full_name" => "matharts/fork", "archived" => false, "disabled" => false, "fork" => true }
      ]
    )

    repositories = governance_config(policy: policy).repositories(api: api, owner: "matharts")

    assert_equal ["matharts/active"], repositories.map { |repository| repository["full_name"] }
    assert_equal [
      [:paginate, "/orgs/matharts/repos?type=all&sort=full_name&direction=asc"]
    ], api.calls
  end

  def test_selects_one_repository_when_the_allowlist_is_omitted
    policy = POLICY.reject { |key, _value| key == :repositories }
    api = FakeApi.new(
      repositories: {
        "/repos/matharts/example" => {
          "full_name" => "matharts/example",
          "archived" => false,
          "disabled" => false,
          "fork" => false
        }
      }
    )

    repositories = governance_config(policy: policy).repositories(
      api: api,
      owner: "matharts",
      only_repository: "matharts/example"
    )

    assert_equal ["matharts/example"], repositories.map { |repository| repository["full_name"] }
    assert_equal [[:get, "/repos/matharts/example"]], api.calls
  end

  def test_policy_requires_aliases_to_remain_owned_as_legacy_names
    policy = POLICY.merge(legacy_names: Set.new(["bug"]).freeze)

    error = assert_raises(RuntimeError) do
      governance_config(policy: policy)
    end

    assert_includes error.message, "enhancement"
  end

  def test_loads_a_valid_self_contained_configuration
    Dir.mktmpdir do |directory|
      labels_path = File.join(directory, "labels.yml")
      policy_path = File.join(directory, "label-policy.yml")

      File.write(labels_path, YAML.dump(DESIRED))
      File.write(
        policy_path,
        YAML.dump(
          "version" => 1,
          "managed" => {
            "prefixes" => ["type:"],
            "exact_names" => ["help wanted"],
            "legacy_names" => %w[bug enhancement]
          },
          "repositories" => { "include" => %w[example docs] }
        )
      )

      config = SyncLabels::GovernanceConfig.load(labels_path: labels_path, policy_path: policy_path)

      assert_equal %w[example docs], config.repository_names
    end
  end

  def test_configuration_defaults_to_all_repositories_when_repositories_are_omitted
    config = load_governance_config(policy_document)
    api = FakeApi.new(
      organization_repositories: [
        { "full_name" => "matharts/example", "archived" => false, "disabled" => false, "fork" => false }
      ]
    )

    repositories = config.repositories(api: api, owner: "matharts")

    assert_equal ["matharts/example"], repositories.map { |repository| repository["full_name"] }
    assert config.all_repositories?
    assert_nil config.repository_names
  end

  def test_configuration_rejects_an_empty_repository_include
    document = policy_document.merge("repositories" => { "include" => [] })

    error = assert_raises(RuntimeError) { load_governance_config(document) }

    assert_includes error.message, "include 不能为空"
  end

  def test_configuration_rejects_unknown_label_fields
    Dir.mktmpdir do |directory|
      labels_path = File.join(directory, "labels.yml")
      policy_path = File.join(directory, "label-policy.yml")
      File.write(labels_path, YAML.dump([{ "name" => "type: bug", "color" => "D73A4A", "extra" => true }]))
      File.write(
        policy_path,
        YAML.dump(
          "version" => 1,
          "managed" => { "prefixes" => ["type:"], "exact_names" => [], "legacy_names" => [] },
          "repositories" => { "include" => ["example"] }
        )
      )

      error = assert_raises(RuntimeError) do
        SyncLabels::GovernanceConfig.load(labels_path: labels_path, policy_path: policy_path)
      end

      assert_includes error.message, "未知字段"
      assert_includes error.message, "extra"
    end
  end

  def test_configuration_reports_invalid_yaml
    Dir.mktmpdir do |directory|
      labels_path = File.join(directory, "labels.yml")
      policy_path = File.join(directory, "label-policy.yml")
      File.write(labels_path, "- name: [\n")
      File.write(policy_path, "version: 1\n")

      error = assert_raises(RuntimeError) do
        SyncLabels::GovernanceConfig.load(labels_path: labels_path, policy_path: policy_path)
      end

      assert_includes error.message, "YAML 无效"
      assert_includes error.message, labels_path
    end
  end

  def test_matharts_configuration_defaults_to_all_eligible_repositories
    config = SyncLabels::GovernanceConfig.load(
      labels_path: File.join(__dir__, ".github/labels.yml"),
      policy_path: File.join(__dir__, ".github/label-policy.yml")
    )

    assert config.all_repositories?
    assert_nil config.repository_names
  end
end
