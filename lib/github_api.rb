# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

class GitHubApi
  DEFAULT_MAX_RETRIES = 3
  MAX_RETRY_DELAY = 60
  TRANSIENT_ERRORS = [
    EOFError,
    Errno::ECONNRESET,
    Errno::ETIMEDOUT,
    Net::OpenTimeout,
    Net::ReadTimeout,
    SocketError
  ].freeze

  def initialize(
    token:,
    base_url:,
    requester: nil,
    sleeper: ->(delay) { sleep(delay) },
    max_retries: DEFAULT_MAX_RETRIES
  )
    base_uri = URI.parse(base_url)
    unless base_uri.is_a?(URI::HTTPS) && base_uri.host && !base_uri.host.empty?
      raise ArgumentError, "GitHub API 地址必须是有效的 HTTPS URL。"
    end
    if base_uri.userinfo || base_uri.query || base_uri.fragment
      raise ArgumentError, "GitHub API 地址不能包含凭据、查询参数或片段。"
    end

    @token = token
    @base_url = base_url.sub(%r{/\z}, "")
    @requester = requester || method(:perform_request)
    @sleeper = sleeper
    @max_retries = Integer(max_retries)
    raise ArgumentError, "max_retries 不能小于 0。" if @max_retries.negative?
  end

  def get(path)
    request(Net::HTTP::Get, path)
  end

  def post(path, body)
    request(Net::HTTP::Post, path, body)
  end

  def patch(path, body)
    request(Net::HTTP::Patch, path, body)
  end

  def delete(path)
    request(Net::HTTP::Delete, path)
  end

  def paginate(path)
    results = []
    page = 1

    loop do
      separator = path.include?("?") ? "&" : "?"
      batch = get("#{path}#{separator}per_page=100&page=#{page}")
      raise "GitHub API 分页结果不是数组。" unless batch.is_a?(Array)

      results.concat(batch)
      break if batch.length < 100

      page += 1
    end

    results
  end

  private

  def request(request_class, path, body = nil)
    uri = URI.parse("#{@base_url}#{path}")
    request = request_class.new(uri)
    request["Accept"] = "application/vnd.github+json"
    request["Authorization"] = "Bearer #{@token}"
    request["User-Agent"] = "matharts-sync-labels"
    request["X-GitHub-Api-Version"] = "2022-11-28"

    unless body.nil?
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(body)
    end

    response = request_with_retries(uri, request)

    unless response.code.to_i.between?(200, 299)
      message = begin
        parsed = JSON.parse(response.body.to_s)
        parsed["message"] || response.body.to_s
      rescue JSON::ParserError
        response.body.to_s
      end

      details = [
        "GitHub API request failed",
        "Method: #{request.method}",
        "Path: #{path}",
        "Status: #{response.code}",
        "Message: #{message}"
      ]

      accepted_permissions = response["x-accepted-github-permissions"].to_s
      oauth_scopes = response["x-oauth-scopes"].to_s
      details << "Accepted permissions: #{accepted_permissions}" unless accepted_permissions.empty?
      details << "Token scopes: #{oauth_scopes}" unless oauth_scopes.empty?

      raise details.join("\n")
    end

    return nil if response.body.nil? || response.body.empty?

    JSON.parse(response.body)
  end

  def perform_request(uri, request)
    Net::HTTP.start(
      uri.hostname,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: 15,
      read_timeout: 60
    ) do |http|
      http.request(request)
    end
  end

  def request_with_retries(uri, request)
    attempt = 0
    idempotent = request.method == "GET"

    loop do
      begin
        response = @requester.call(uri, request)
      rescue *TRANSIENT_ERRORS => error
        raise unless idempotent && attempt < @max_retries

        delay = exponential_backoff(attempt)
        warn "GitHub API 网络错误，#{delay} 秒后重试（#{attempt + 1}/#{@max_retries}）：#{error.class}"
        @sleeper.call(delay)
        attempt += 1
        next
      end

      return response unless idempotent && retryable_response?(response) && attempt < @max_retries

      delay = retry_delay(response, attempt)
      warn "GitHub API 返回 #{response.code}，#{delay} 秒后重试（#{attempt + 1}/#{@max_retries}）。"
      @sleeper.call(delay)
      attempt += 1
    end
  end

  def retryable_response?(response)
    status = response.code.to_i
    return true if status == 429 || status.between?(500, 599)

    status == 403 && (
      !response["retry-after"].to_s.empty? ||
      response["x-ratelimit-remaining"].to_s == "0" ||
      !response["x-ratelimit-reset"].to_s.empty?
    )
  end

  def retry_delay(response, attempt)
    retry_after = response["retry-after"].to_s
    return [retry_after.to_i, MAX_RETRY_DELAY].min if retry_after.match?(/\A\d+\z/)

    reset_at = response["x-ratelimit-reset"].to_s
    if reset_at.match?(/\A\d+\z/)
      return [[reset_at.to_i - Time.now.to_i, 0].max, MAX_RETRY_DELAY].min
    end

    exponential_backoff(attempt)
  end

  def exponential_backoff(attempt)
    [2**attempt, MAX_RETRY_DELAY].min
  end
end
