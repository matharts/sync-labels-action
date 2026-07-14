# frozen_string_literal: true

require_relative "governance_config"

module SyncLabels
  class RepositorySynchronizer
    def initialize(api:, config:, dry_run:, output: $stdout)
      @api = api
      @config = config
      @dry_run = dry_run
      @output = output
    end

    def sync(full_name)
      sync_repository(
        @api,
        full_name,
        @config.labels,
        dry_run: @dry_run
      )
    end

    private

    def mutate(api, dry_run, method, *arguments)
      api.public_send(method, *arguments) unless dry_run
    end
    
    def sync_repository(api, full_name, desired_labels, dry_run:)
      path = GovernanceInternals.repository_path(full_name)
      existing = api.paginate("/repos/#{path}/labels")
      labels_by_name = existing.to_h { |label| [GovernanceInternals.label_key(label["name"]), label] }
    
      desired_keys = desired_labels.map { |label| GovernanceInternals.label_key(label["name"]) }.to_set
    
      counts = {
        created: 0,
        updated: 0,
        renamed: 0,
        deleted: 0,
        unchanged: 0,
        preserved: 0
      }
    
      @output.puts "::group::#{full_name}"
    
      desired_labels.each do |desired|
        desired_name = desired["name"]
        desired_key = GovernanceInternals.label_key(desired_name)
        current = labels_by_name[desired_key]
        alias_matches = desired["aliases"].map { |alias_name| labels_by_name[GovernanceInternals.label_key(alias_name)] }.compact
          .uniq { |label| GovernanceInternals.label_key(label["name"]) }
    
        if current
          changed = current["name"] != desired_name ||
            current["color"].to_s.upcase != desired["color"] ||
            current["description"].to_s != desired["description"]
    
          if changed
            @output.puts "#{dry_run ? 'WOULD UPDATE' : 'UPDATE'}     #{current['name']} -> #{desired_name}"
            mutate(
              api,
              dry_run,
              :patch,
              "/repos/#{path}/labels/#{GovernanceInternals.escape_segment(current['name'])}",
              {
                new_name: desired_name,
                color: desired["color"],
                description: desired["description"]
              }
            )
            counts[:updated] += 1
          else
            @output.puts "UNCHANGED       #{desired_name}"
            counts[:unchanged] += 1
          end
    
          labels_by_name.delete(GovernanceInternals.label_key(current["name"]))
          labels_by_name[desired_key] = desired
    
          alias_matches.each do |legacy|
            legacy_name = legacy.fetch("name")
            @output.puts "#{dry_run ? 'WOULD DELETE' : 'DELETE'}     legacy alias #{legacy_name}"
            mutate(api, dry_run, :delete, "/repos/#{path}/labels/#{GovernanceInternals.escape_segment(legacy_name)}")
            labels_by_name.delete(GovernanceInternals.label_key(legacy_name))
            counts[:deleted] += 1
          end
    
          next
        end
    
        if alias_matches.length > 1
          names = alias_matches.map { |label| label["name"] }.join(", ")
          raise "多个旧标签同时映射到 #{desired_name}：#{names}"
        end
    
        if alias_matches.length == 1
          old = alias_matches.first
          @output.puts "#{dry_run ? 'WOULD RENAME' : 'RENAME'}     #{old['name']} -> #{desired_name}"
          mutate(
            api,
            dry_run,
            :patch,
            "/repos/#{path}/labels/#{GovernanceInternals.escape_segment(old['name'])}",
            {
              new_name: desired_name,
              color: desired["color"],
              description: desired["description"]
            }
          )
          labels_by_name.delete(GovernanceInternals.label_key(old["name"]))
          labels_by_name[desired_key] = desired
          counts[:renamed] += 1
          next
        end
    
        @output.puts "#{dry_run ? 'WOULD CREATE' : 'CREATE'}     #{desired_name}"
        mutate(
          api,
          dry_run,
          :post,
          "/repos/#{path}/labels",
          {
            name: desired_name,
            color: desired["color"],
            description: desired["description"]
          }
        )
        labels_by_name[desired_key] = desired
        counts[:created] += 1
      end
    
      remaining = labels_by_name.values.reject { |label| desired_keys.include?(GovernanceInternals.label_key(label["name"])) }
      stale_managed, repository_specific = remaining.partition { |label| @config.managed?(label["name"]) }
    
      stale_managed.sort_by { |label| label["name"].downcase }.each do |label|
        name = label.fetch("name")
        @output.puts "#{dry_run ? 'WOULD DELETE' : 'DELETE'}     stale organization label #{name}"
        mutate(api, dry_run, :delete, "/repos/#{path}/labels/#{GovernanceInternals.escape_segment(name)}")
        counts[:deleted] += 1
      end
    
      repository_specific.sort_by { |label| label["name"].downcase }.each do |label|
        @output.puts "PRESERVE        repository label #{label['name']}"
        counts[:preserved] += 1
      end
    
      @output.puts "::endgroup::"
      counts
    rescue StandardError
      @output.puts "::endgroup::"
      raise
    end
  end
end
