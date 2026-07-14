# frozen_string_literal: true

module SyncLabels
  SyncResult = Struct.new(
    :created,
    :updated,
    :renamed,
    :deleted,
    :unchanged,
    :preserved,
    keyword_init: true
  ) do
    def self.zero
      new(created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, preserved: 0)
    end
  end

  RepositoryOutcome = Struct.new(:repository, :status, :counts, keyword_init: true)
end
