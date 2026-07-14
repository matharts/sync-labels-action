#!/usr/bin/env ruby
# frozen_string_literal: true

ACTION_FILE_GLOBS = [
  "action.{yml,yaml}",
  ".github/workflows/*.{yml,yaml}"
].freeze
LOCAL_REFERENCE_PREFIX = "./"
FULL_COMMIT_SHA = /\A[0-9a-fA-F]{40}\z/
CONTAINER_DIGEST = /\Adocker:\/\/.+@sha256:[0-9a-fA-F]{64}\z/
USES_PATTERN = /^\s*(?:-\s*)?uses\s*:\s*(?:"([^"]+)"|'([^']+)'|([^#\s]+))/

files = ACTION_FILE_GLOBS.flat_map { |pattern| Dir.glob(pattern) }.uniq.sort
errors = []
external_references = 0

files.each do |file|
  File.foreach(file, encoding: "UTF-8").with_index(1) do |line, number|
    match = line.match(USES_PATTERN)
    next unless match

    reference = match.captures.compact.first.to_s.strip
    next if reference.start_with?(LOCAL_REFERENCE_PREFIX)

    external_references += 1
    if reference.start_with?("docker://")
      next if CONTAINER_DIGEST.match?(reference)

      warn "#{file}:#{number}: Docker Action 必须固定到 sha256 digest：#{reference}"
      errors << [file, number, reference]
      next
    end

    action, separator, revision = reference.rpartition("@")
    next if separator == "@" && !action.empty? && FULL_COMMIT_SHA.match?(revision)

    warn "#{file}:#{number}: 外部 Action 必须固定到完整 Commit SHA：#{reference}"
    errors << [file, number, reference]
  end
end

if errors.empty?
  puts "已验证 #{external_references} 个外部 Action 引用，全部固定到 Commit SHA 或容器 digest。"
  exit 0
end

exit 1
