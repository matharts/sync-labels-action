# frozen_string_literal: true

require "uri"

module SyncLabels
  module LabelIdentity
    module_function

    def key(value)
      value.to_s.unicode_normalize(:nfc).downcase
    rescue StandardError
      value.to_s.downcase
    end

    def escape(value)
      URI.encode_www_form_component(value.to_s).gsub("+", "%20")
    end

    def repository_path(full_name)
      owner, repository = full_name.split("/", 2)
      raise "无效仓库名称：#{full_name.inspect}" if owner.to_s.empty? || repository.to_s.empty?

      "#{escape(owner)}/#{escape(repository)}"
    end
  end
end
