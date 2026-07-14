# frozen_string_literal: true

require "set"
require_relative "label_identity"
require_relative "sync_result"

module SyncLabels
  class RepositorySynchronizer
    def initialize(api:, config:, dry_run:, output: $stdout)
      @api = api
      @config = config
      @dry_run = dry_run
      @output = output
    end

    def sync(full_name)
      path = LabelIdentity.repository_path(full_name)
      existing = @api.paginate("/repos/#{path}/labels")
      labels_by_name = existing.to_h { |label| [LabelIdentity.key(label["name"]), label] }

      desired_keys = @config.labels.map { |label| LabelIdentity.key(label["name"]) }.to_set

      counts = SyncResult.zero

      @output.puts "::group::#{full_name}"

      @config.labels.each do |desired|
        desired_name = desired["name"]
        desired_key = LabelIdentity.key(desired_name)
        current = labels_by_name[desired_key]
        alias_matches = desired["aliases"].map { |alias_name| labels_by_name[LabelIdentity.key(alias_name)] }.compact
          .uniq { |label| LabelIdentity.key(label["name"]) }

        if current
          changed = current["name"] != desired_name ||
            current["color"].to_s.upcase != desired["color"] ||
            current["description"].to_s != desired["description"]

          if changed
            @output.puts "#{@dry_run ? 'WOULD UPDATE' : 'UPDATE'}     #{current['name']} -> #{desired_name}"
            mutate(
              :patch,
              "/repos/#{path}/labels/#{LabelIdentity.escape(current['name'])}",
              {
                new_name: desired_name,
                color: desired["color"],
                description: desired["description"]
              }
            )
            counts.updated += 1
          else
            @output.puts "UNCHANGED       #{desired_name}"
            counts.unchanged += 1
          end

          labels_by_name.delete(LabelIdentity.key(current["name"]))
          labels_by_name[desired_key] = desired

          alias_matches.each do |legacy|
            legacy_name = legacy.fetch("name")
            @output.puts "#{@dry_run ? 'WOULD DELETE' : 'DELETE'}     legacy alias #{legacy_name}"
            mutate(:delete, "/repos/#{path}/labels/#{LabelIdentity.escape(legacy_name)}")
            labels_by_name.delete(LabelIdentity.key(legacy_name))
            counts.deleted += 1
          end

          next
        end

        if alias_matches.length > 1
          names = alias_matches.map { |label| label["name"] }.join(", ")
          raise "多个旧标签同时映射到 #{desired_name}：#{names}"
        end

        if alias_matches.length == 1
          old = alias_matches.first
          @output.puts "#{@dry_run ? 'WOULD RENAME' : 'RENAME'}     #{old['name']} -> #{desired_name}"
          mutate(
            :patch,
            "/repos/#{path}/labels/#{LabelIdentity.escape(old['name'])}",
            {
              new_name: desired_name,
              color: desired["color"],
              description: desired["description"]
            }
          )
          labels_by_name.delete(LabelIdentity.key(old["name"]))
          labels_by_name[desired_key] = desired
          counts.renamed += 1
          next
        end

        @output.puts "#{@dry_run ? 'WOULD CREATE' : 'CREATE'}     #{desired_name}"
        mutate(
          :post,
          "/repos/#{path}/labels",
          {
            name: desired_name,
            color: desired["color"],
            description: desired["description"]
          }
        )
        labels_by_name[desired_key] = desired
        counts.created += 1
      end

      remaining = labels_by_name.values.reject { |label| desired_keys.include?(LabelIdentity.key(label["name"])) }
      stale_managed, repository_specific = remaining.partition { |label| @config.managed?(label["name"]) }

      stale_managed.sort_by { |label| label["name"].downcase }.each do |label|
        name = label.fetch("name")
        @output.puts "#{@dry_run ? 'WOULD DELETE' : 'DELETE'}     stale organization label #{name}"
        mutate(:delete, "/repos/#{path}/labels/#{LabelIdentity.escape(name)}")
        counts.deleted += 1
      end

      repository_specific.sort_by { |label| label["name"].downcase }.each do |label|
        @output.puts "PRESERVE        repository label #{label['name']}"
        counts.preserved += 1
      end

      @output.puts "::endgroup::"
      counts
    rescue StandardError
      @output.puts "::endgroup::"
      raise
    end

    private

    def mutate(method, *arguments)
      @api.public_send(method, *arguments) unless @dry_run
    end
  end
end
