export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      announcements: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          message: string
          sent: boolean
          tag: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          message: string
          sent?: boolean
          tag?: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          message?: string
          sent?: boolean
          tag?: string
          title?: string
        }
        Relationships: []
      }
      news_posts: {
        Row: {
          author_id: string | null
          category: string
          content_html: string
          content_json: Json
          created_at: string
          excerpt: string | null
          hero_image_alt: string | null
          hero_image_url: string | null
          id: string
          is_featured: boolean
          language: string
          last_viewed_at: string | null
          og_image_url: string | null
          published_at: string | null
          race_id: string | null
          season_id: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: string
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          author_id?: string | null
          category?: string
          content_html?: string
          content_json?: Json
          created_at?: string
          excerpt?: string | null
          hero_image_alt?: string | null
          hero_image_url?: string | null
          id?: string
          is_featured?: boolean
          language?: string
          last_viewed_at?: string | null
          og_image_url?: string | null
          published_at?: string | null
          race_id?: string | null
          season_id?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          author_id?: string | null
          category?: string
          content_html?: string
          content_json?: Json
          created_at?: string
          excerpt?: string | null
          hero_image_alt?: string | null
          hero_image_url?: string | null
          id?: string
          is_featured?: boolean
          language?: string
          last_viewed_at?: string | null
          og_image_url?: string | null
          published_at?: string | null
          race_id?: string | null
          season_id?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "news_posts_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_posts_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      discord_link_codes: {
        Row: {
          code: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code: string
          expires_at?: string
          user_id: string
        }
        Update: {
          code?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: []
      }
      discord_link_tokens: {
        Row: {
          discord_id: string
          discord_tag: string | null
          expires_at: string
          token: string
          used: boolean
        }
        Insert: {
          discord_id: string
          discord_tag?: string | null
          expires_at?: string
          token?: string
          used?: boolean
        }
        Update: {
          discord_id?: string
          discord_tag?: string | null
          expires_at?: string
          token?: string
          used?: boolean
        }
        Relationships: []
      }
      driver_3sr: {
        Row: {
          current_score: number
          is_ranked: boolean
          last_updated: string
          rank_label: string | null
          ranked_races: number
          user_id: string
        }
        Insert: {
          current_score?: number
          is_ranked?: boolean
          last_updated?: string
          rank_label?: string | null
          ranked_races?: number
          user_id: string
        }
        Update: {
          current_score?: number
          is_ranked?: boolean
          last_updated?: string
          rank_label?: string | null
          ranked_races?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_3sr_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "confirmed_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "driver_3sr_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      endurance_audit_log: {
        Row: {
          id: string
          event_id: string | null
          actor_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          before_data: Json | null
          after_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string | null
          actor_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          before_data: Json | null
          after_data: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string | null
          actor_id?: string | null
          action?: string
          entity_type?: string
          entity_id?: string | null
          before_data?: Json | null
          after_data?: Json | null
          created_at?: string
        }
        Relationships: []
      }

      endurance_availability: {
        Row: {
          id: string
          event_id: string
          user_id: string
          start_at: string
          end_at: string
          type: Database["public"]["Enums"]["endurance_availability_type"]
          note: string | null
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          start_at: string
          end_at: string
          type: Database["public"]["Enums"]["endurance_availability_type"]
          note: string | null
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          start_at?: string
          end_at?: string
          type?: Database["public"]["Enums"]["endurance_availability_type"]
          note?: string | null
        }
        Relationships: []
      }

      endurance_confirmations: {
        Row: {
          id: string
          event_id: string
          version_id: string
          user_id: string
          status: Database["public"]["Enums"]["endurance_confirmation_status"]
          note: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          version_id: string
          user_id: string
          status: Database["public"]["Enums"]["endurance_confirmation_status"]
          note: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          version_id?: string
          user_id?: string
          status?: Database["public"]["Enums"]["endurance_confirmation_status"]
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      endurance_events: {
        Row: {
          id: string
          name: string
          circuit: string
          configuration: string
          image_url: string | null
          start_at: string
          end_at: string
          briefing_start_at: string | null
          expected_end_at: string | null
          registration_deadline: string | null
          slots: Json
          class_ids: string[]
          selected_class_id: string | null
          selected_car_id: string | null
          max_drivers_per_car: number
          visibility: Database["public"]["Enums"]["endurance_event_visibility"]
          status: Database["public"]["Enums"]["endurance_event_status"]
          source: string
          invited_user_ids: string[]
          manager_ids: string[]
          race_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          circuit: string
          configuration: string
          image_url: string | null
          start_at: string
          end_at: string
          briefing_start_at: string | null
          expected_end_at: string | null
          registration_deadline: string | null
          slots: Json
          class_ids: string[]
          selected_class_id: string | null
          selected_car_id: string | null
          max_drivers_per_car: number
          visibility: Database["public"]["Enums"]["endurance_event_visibility"]
          status: Database["public"]["Enums"]["endurance_event_status"]
          source: string
          invited_user_ids: string[]
          manager_ids: string[]
          race_id: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          circuit?: string
          configuration?: string
          image_url?: string | null
          start_at?: string
          end_at?: string
          briefing_start_at?: string | null
          expected_end_at?: string | null
          registration_deadline?: string | null
          slots?: Json
          class_ids?: string[]
          selected_class_id?: string | null
          selected_car_id?: string | null
          max_drivers_per_car?: number
          visibility?: Database["public"]["Enums"]["endurance_event_visibility"]
          status?: Database["public"]["Enums"]["endurance_event_status"]
          source?: string
          invited_user_ids?: string[]
          manager_ids?: string[]
          race_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }

      endurance_notifications: {
        Row: {
          id: string
          user_id: string
          event_id: string | null
          type: Database["public"]["Enums"]["endurance_notification_type"]
          title: string
          message: string | null
          private_path: string | null
          read: boolean
          discord_status: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          event_id: string | null
          type: Database["public"]["Enums"]["endurance_notification_type"]
          title: string
          message: string | null
          private_path: string | null
          read: boolean
          discord_status: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          event_id?: string | null
          type?: Database["public"]["Enums"]["endurance_notification_type"]
          title?: string
          message?: string | null
          private_path?: string | null
          read?: boolean
          discord_status?: string
          created_at?: string
        }
        Relationships: []
      }

      endurance_pace_entries: {
        Row: {
          id: string
          event_id: string | null
          user_id: string
          circuit: string
          configuration: string
          car: string
          conditions: string
          average_lap_seconds: number | null
          median_lap_seconds: number | null
          best_lap_seconds: number | null
          best_five_average_seconds: number | null
          consistency_seconds: number | null
          valid_laps: number | null
          incidents: number | null
          average_stint_minutes: number | null
          recorded_at: string
          source: string
          notes: string | null
        }
        Insert: {
          id?: string
          event_id: string | null
          user_id: string
          circuit: string
          configuration: string
          car: string
          conditions: string
          average_lap_seconds: number | null
          median_lap_seconds: number | null
          best_lap_seconds: number | null
          best_five_average_seconds: number | null
          consistency_seconds: number | null
          valid_laps: number | null
          incidents: number | null
          average_stint_minutes: number | null
          recorded_at?: string
          source: string
          notes: string | null
        }
        Update: {
          id?: string
          event_id?: string | null
          user_id?: string
          circuit?: string
          configuration?: string
          car?: string
          conditions?: string
          average_lap_seconds?: number | null
          median_lap_seconds?: number | null
          best_lap_seconds?: number | null
          best_five_average_seconds?: number | null
          consistency_seconds?: number | null
          valid_laps?: number | null
          incidents?: number | null
          average_stint_minutes?: number | null
          recorded_at?: string
          source?: string
          notes?: string | null
        }
        Relationships: []
      }

      endurance_planning_versions: {
        Row: {
          id: string
          event_id: string
          team_id: string
          label: string
          created_by: string | null
          published: boolean
          created_at: string
          stints: Json
        }
        Insert: {
          id?: string
          event_id: string
          team_id: string
          label: string
          created_by: string | null
          published: boolean
          created_at?: string
          stints: Json
        }
        Update: {
          id?: string
          event_id?: string
          team_id?: string
          label?: string
          created_by?: string | null
          published?: boolean
          created_at?: string
          stints?: Json
        }
        Relationships: []
      }

      endurance_registrations: {
        Row: {
          id: string
          event_id: string
          user_id: string
          status: Database["public"]["Enums"]["endurance_registration_status"]
          class_preference: string | null
          preferred_car_id: string | null
          slot_id: string | null
          max_stints: number | null
          night_driving: boolean
          willing_to_start: boolean
          willing_to_finish: boolean
          notes: string | null
          registered_at: string
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          status: Database["public"]["Enums"]["endurance_registration_status"]
          class_preference: string | null
          preferred_car_id: string | null
          slot_id: string | null
          max_stints: number | null
          night_driving: boolean
          willing_to_start: boolean
          willing_to_finish: boolean
          notes: string | null
          registered_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          status?: Database["public"]["Enums"]["endurance_registration_status"]
          class_preference?: string | null
          preferred_car_id?: string | null
          slot_id?: string | null
          max_stints?: number | null
          night_driving?: boolean
          willing_to_start?: boolean
          willing_to_finish?: boolean
          notes?: string | null
          registered_at?: string
        }
        Relationships: []
      }

      endurance_stints: {
        Row: {
          id: string
          event_id: string
          team_id: string
          driver_id: string | null
          original_start_at: string
          original_end_at: string
          actual_start_at: string | null
          actual_end_at: string | null
          expected_laps: number | null
          fuel_litres: number | null
          tyre_change: boolean
          double_stint: boolean
          notes: string | null
          status: Database["public"]["Enums"]["endurance_stint_status"]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          team_id: string
          driver_id: string | null
          original_start_at: string
          original_end_at: string
          actual_start_at: string | null
          actual_end_at: string | null
          expected_laps: number | null
          fuel_litres: number | null
          tyre_change: boolean
          double_stint: boolean
          notes: string | null
          status: Database["public"]["Enums"]["endurance_stint_status"]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          team_id?: string
          driver_id?: string | null
          original_start_at?: string
          original_end_at?: string
          actual_start_at?: string | null
          actual_end_at?: string | null
          expected_laps?: number | null
          fuel_litres?: number | null
          tyre_change?: boolean
          double_stint?: boolean
          notes?: string | null
          status?: Database["public"]["Enums"]["endurance_stint_status"]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }

      endurance_practice_laps: {
        Row: {
          id: string
          session_id: string
          event_id: string
          user_id: string | null
          car_id: string | null
          circuit: string | null
          lap_seconds: number
          fuel_used_litres: number | null
          fuel_per_lap_litres: number | null
          incident_count: number
          recorded_at: string
        }
        Insert: {
          id?: string
          session_id: string
          event_id: string
          user_id?: string | null
          car_id?: string | null
          circuit?: string | null
          lap_seconds: number
          fuel_used_litres?: number | null
          fuel_per_lap_litres?: number | null
          incident_count?: number
          recorded_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          event_id?: string
          user_id?: string | null
          car_id?: string | null
          circuit?: string | null
          lap_seconds?: number
          fuel_used_litres?: number | null
          fuel_per_lap_litres?: number | null
          incident_count?: number
          recorded_at?: string
        }
        Relationships: []
      }

      endurance_practice_sessions: {
        Row: {
          id: string
          event_id: string
          team_id: string | null
          label: string
          started_at: string
          ended_at: string | null
          requires_registered: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          team_id?: string | null
          label?: string
          started_at?: string
          ended_at?: string | null
          requires_registered?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          team_id?: string | null
          label?: string
          started_at?: string
          ended_at?: string | null
          requires_registered?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }

      endurance_team_members: {
        Row: {
          id: string
          team_id: string
          user_id: string
          role: Database["public"]["Enums"]["endurance_team_role"]
        }
        Insert: {
          id?: string
          team_id: string
          user_id: string
          role: Database["public"]["Enums"]["endurance_team_role"]
        }
        Update: {
          id?: string
          team_id?: string
          user_id?: string
          role?: Database["public"]["Enums"]["endurance_team_role"]
        }
        Relationships: []
      }

      endurance_teams: {
        Row: {
          id: string
          event_id: string
          name: string
          car_id: string | null
          car_number: string | null
          manager_id: string | null
          livery: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          name: string
          car_id: string | null
          car_number: string | null
          manager_id: string | null
          livery: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          name?: string
          car_id?: string | null
          car_number?: string | null
          manager_id?: string | null
          livery?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }

      leagues: {
        Row: {
          car_class: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          season: string | null
          status: string
          updated_at: string
        }
        Insert: {
          car_class?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          season?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          car_class?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          season?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      penalties: {
        Row: {
          applied_by: string | null
          correction_sent: boolean | null
          created_at: string
          discord_message_id: string | null
          grid_penalty_places: number
          id: string
          league_id: string | null
          notified: boolean | null
          penalty_category: string | null
          penalty_sp: number
          penalty_type: string
          points_deduction: number | null
          protest_id: string | null
          race_ban_next: boolean
          race_id: string
          reason: string
          revoked: boolean | null
          source: string | null
          steward_description: string | null
          steward_initiated: boolean
          time_penalty_seconds: number | null
          user_id: string
        }
        Insert: {
          applied_by?: string | null
          correction_sent?: boolean | null
          created_at?: string
          discord_message_id?: string | null
          grid_penalty_places?: number
          id?: string
          league_id?: string | null
          notified?: boolean | null
          penalty_category?: string | null
          penalty_sp?: number
          penalty_type: string
          points_deduction?: number | null
          protest_id?: string | null
          race_ban_next?: boolean
          race_id: string
          reason: string
          revoked?: boolean | null
          source?: string | null
          steward_description?: string | null
          steward_initiated?: boolean
          time_penalty_seconds?: number | null
          user_id: string
        }
        Update: {
          applied_by?: string | null
          correction_sent?: boolean | null
          created_at?: string
          discord_message_id?: string | null
          grid_penalty_places?: number
          id?: string
          league_id?: string | null
          notified?: boolean | null
          penalty_category?: string | null
          penalty_sp?: number
          penalty_type?: string
          points_deduction?: number | null
          protest_id?: string | null
          race_ban_next?: boolean
          race_id?: string
          reason?: string
          revoked?: boolean | null
          source?: string | null
          steward_description?: string | null
          steward_initiated?: boolean
          time_penalty_seconds?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "penalties_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_protest_id_fkey"
            columns: ["protest_id"]
            isOneToOne: false
            referencedRelation: "protests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "v_3sr_race_eligibility"
            referencedColumns: ["race_id"]
          },
        ]
      }
      points_config: {
        Row: {
          id: string
          league_id: string
          points: number
          position: number
        }
        Insert: {
          id?: string
          league_id: string
          points: number
          position: number
        }
        Update: {
          id?: string
          league_id?: string
          points?: number
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "points_config_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          discord_id: string | null
          display_name: string | null
          id: string
          iracing_id: string | null
          iracing_name: string | null
          irating: number | null
          safety_rating: string | null
          team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          discord_id?: string | null
          display_name?: string | null
          id?: string
          iracing_id?: string | null
          iracing_name?: string | null
          irating?: number | null
          safety_rating?: string | null
          team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          discord_id?: string | null
          display_name?: string | null
          id?: string
          iracing_id?: string | null
          iracing_name?: string | null
          irating?: number | null
          safety_rating?: string | null
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      protests: {
        Row: {
          accused_user_id: string
          created_at: string
          decided_at: string | null
          description: string
          grid_penalty_places: number | null
          id: string
          lap_number: number | null
          notified: boolean
          penalty_category: string | null
          penalty_points: number | null
          penalty_type: string | null
          public_decision: string | null
          race_ban_next: boolean
          race_id: string
          reporter_user_id: string
          status: string
          steward_notes: string | null
          time_penalty_seconds: number | null
          updated_at: string
          video_link: string | null
        }
        Insert: {
          accused_user_id: string
          created_at?: string
          decided_at?: string | null
          description: string
          grid_penalty_places?: number | null
          id?: string
          lap_number?: number | null
          notified?: boolean
          penalty_category?: string | null
          penalty_points?: number | null
          penalty_type?: string | null
          public_decision?: string | null
          race_ban_next?: boolean
          race_id: string
          reporter_user_id: string
          status?: string
          steward_notes?: string | null
          time_penalty_seconds?: number | null
          updated_at?: string
          video_link?: string | null
        }
        Update: {
          accused_user_id?: string
          created_at?: string
          decided_at?: string | null
          description?: string
          grid_penalty_places?: number | null
          id?: string
          lap_number?: number | null
          notified?: boolean
          penalty_category?: string | null
          penalty_points?: number | null
          penalty_type?: string | null
          public_decision?: string | null
          race_ban_next?: boolean
          race_id?: string
          reporter_user_id?: string
          status?: string
          steward_notes?: string | null
          time_penalty_seconds?: number | null
          updated_at?: string
          video_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protests_accused_user_id_fkey"
            columns: ["accused_user_id"]
            isOneToOne: false
            referencedRelation: "confirmed_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "protests_accused_user_id_fkey"
            columns: ["accused_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "protests_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protests_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "v_3sr_race_eligibility"
            referencedColumns: ["race_id"]
          },
          {
            foreignKeyName: "protests_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "confirmed_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "protests_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      race_3sr_results: {
        Row: {
          calculated_at: string
          delta: number | null
          dnf: boolean
          effective_position: number
          expected_position: number | null
          finishers: number
          id: string
          irating_rank: number | null
          irating_snapshot: number | null
          penalty_deduction: number
          performance_bonus: number
          position: number
          position_score: number
          race_id: string
          race_score: number
          user_id: string
        }
        Insert: {
          calculated_at?: string
          delta?: number | null
          dnf?: boolean
          effective_position: number
          expected_position?: number | null
          finishers: number
          id?: string
          irating_rank?: number | null
          irating_snapshot?: number | null
          penalty_deduction?: number
          performance_bonus?: number
          position: number
          position_score: number
          race_id: string
          race_score: number
          user_id: string
        }
        Update: {
          calculated_at?: string
          delta?: number | null
          dnf?: boolean
          effective_position?: number
          expected_position?: number | null
          finishers?: number
          id?: string
          irating_rank?: number | null
          irating_snapshot?: number | null
          penalty_deduction?: number
          performance_bonus?: number
          position?: number
          position_score?: number
          race_id?: string
          race_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_3sr_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_3sr_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "v_3sr_race_eligibility"
            referencedColumns: ["race_id"]
          },
          {
            foreignKeyName: "race_3sr_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "confirmed_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "race_3sr_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      race_registrations: {
        Row: {
          car_choice: string | null
          car_locked: boolean
          created_at: string
          id: string
          race_id: string
          status: string
          user_id: string
        }
        Insert: {
          car_choice?: string | null
          car_locked?: boolean
          created_at?: string
          id?: string
          race_id: string
          status?: string
          user_id: string
        }
        Update: {
          car_choice?: string | null
          car_locked?: boolean
          created_at?: string
          id?: string
          race_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_registrations_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_registrations_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "v_3sr_race_eligibility"
            referencedColumns: ["race_id"]
          },
        ]
      }
      race_results: {
        Row: {
          avg_lap: string | null
          best_lap: string | null
          best_lap_num: number | null
          car_name: string | null
          club_name: string | null
          country_code: string | null
          created_at: string
          dnf: boolean
          fastest_lap: boolean
          gap_to_leader: string | null
          id: string
          incidents: number | null
          iracing_cust_id: string | null
          irating_snapshot: number | null
          laps: number | null
          laps_led: number | null
          points: number
          position: number
          race_id: string
          reason_out: string | null
          start_position: number | null
          user_id: string
        }
        Insert: {
          avg_lap?: string | null
          best_lap?: string | null
          best_lap_num?: number | null
          car_name?: string | null
          club_name?: string | null
          country_code?: string | null
          created_at?: string
          dnf?: boolean
          fastest_lap?: boolean
          gap_to_leader?: string | null
          id?: string
          incidents?: number | null
          iracing_cust_id?: string | null
          irating_snapshot?: number | null
          laps?: number | null
          laps_led?: number | null
          points?: number
          position: number
          race_id: string
          reason_out?: string | null
          start_position?: number | null
          user_id: string
        }
        Update: {
          avg_lap?: string | null
          best_lap?: string | null
          best_lap_num?: number | null
          car_name?: string | null
          club_name?: string | null
          country_code?: string | null
          created_at?: string
          dnf?: boolean
          fastest_lap?: boolean
          gap_to_leader?: string | null
          id?: string
          incidents?: number | null
          iracing_cust_id?: string | null
          irating_snapshot?: number | null
          laps?: number | null
          laps_led?: number | null
          points?: number
          position?: number
          race_id?: string
          reason_out?: string | null
          start_position?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "v_3sr_race_eligibility"
            referencedColumns: ["race_id"]
          },
          {
            foreignKeyName: "race_results_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "confirmed_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "race_results_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      race_session_results: {
        Row: {
          avg_lap: string | null
          best_lap: string | null
          best_lap_num: number | null
          car_name: string | null
          club_name: string | null
          country_code: string | null
          created_at: string
          display_name: string
          id: string
          incidents: number | null
          iracing_cust_id: string | null
          laps: number | null
          position: number
          race_id: string
          session_name: string | null
          session_number: number | null
          session_type: string
        }
        Insert: {
          avg_lap?: string | null
          best_lap?: string | null
          best_lap_num?: number | null
          car_name?: string | null
          club_name?: string | null
          country_code?: string | null
          created_at?: string
          display_name: string
          id?: string
          incidents?: number | null
          iracing_cust_id?: string | null
          laps?: number | null
          position: number
          race_id: string
          session_name?: string | null
          session_number?: number | null
          session_type: string
        }
        Update: {
          avg_lap?: string | null
          best_lap?: string | null
          best_lap_num?: number | null
          car_name?: string | null
          club_name?: string | null
          country_code?: string | null
          created_at?: string
          display_name?: string
          id?: string
          incidents?: number | null
          iracing_cust_id?: string | null
          laps?: number | null
          position?: number
          race_id?: string
          session_name?: string | null
          session_number?: number | null
          session_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_session_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          car: string | null
          counts_for_3sr: boolean
          created_at: string
          id: string
          iracing_session_id: string | null
          iracing_track_id: number | null
          caution_laps: number | null
          cautions: number | null
          league_id: string | null
          lead_changes: number | null
          lobby_name: string | null
          lobby_password: string | null
          lobby_reveal_minutes: number
          name: string
          practice_duration: string | null
          qualifying_duration: string | null
          race_date: string
          race_duration: string | null
          race_type: string | null
          round: number | null
          setup: string | null
          sof: number | null
          start_type: string | null
          status: string
          total_laps: number | null
          track: string
          updated_at: string
          weather: string | null
        }
        Insert: {
          car?: string | null
          counts_for_3sr?: boolean
          created_at?: string
          id?: string
          iracing_session_id?: string | null
          iracing_track_id?: number | null
          caution_laps?: number | null
          cautions?: number | null
          league_id?: string | null
          lead_changes?: number | null
          lobby_name?: string | null
          lobby_password?: string | null
          lobby_reveal_minutes?: number
          name: string
          practice_duration?: string | null
          qualifying_duration?: string | null
          race_date: string
          race_duration?: string | null
          race_type?: string | null
          round?: number | null
          setup?: string | null
          sof?: number | null
          start_type?: string | null
          status?: string
          total_laps?: number | null
          track: string
          updated_at?: string
          weather?: string | null
        }
        Update: {
          car?: string | null
          counts_for_3sr?: boolean
          created_at?: string
          id?: string
          iracing_session_id?: string | null
          iracing_track_id?: number | null
          caution_laps?: number | null
          cautions?: number | null
          league_id?: string | null
          lead_changes?: number | null
          lobby_name?: string | null
          lobby_password?: string | null
          lobby_reveal_minutes?: number
          name?: string
          practice_duration?: string | null
          qualifying_duration?: string | null
          race_date?: string
          race_duration?: string | null
          race_type?: string | null
          round?: number | null
          setup?: string | null
          sof?: number | null
          start_type?: string | null
          status?: string
          total_laps?: number | null
          track?: string
          updated_at?: string
          weather?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "races_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      season_registrations: {
        Row: {
          car_choice: string | null
          car_locked: boolean
          created_at: string
          id: string
          league_id: string
          status: string
          user_id: string
        }
        Insert: {
          car_choice?: string | null
          car_locked?: boolean
          created_at?: string
          id?: string
          league_id: string
          status?: string
          user_id: string
        }
        Update: {
          car_choice?: string | null
          car_locked?: boolean
          created_at?: string
          id?: string
          league_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_registrations_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      team_creation_requests: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          status: string
          team_color: string
          team_description: string | null
          team_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          status?: string
          team_color?: string
          team_description?: string | null
          team_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          status?: string
          team_color?: string
          team_description?: string | null
          team_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_creation_requests_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "confirmed_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "team_creation_requests_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      simhub_pairing_codes: {
        Row: { code_hash: string; consumed_at: string | null; created_at: string; expires_at: string; id: string; owner_user_id: string; race_id: string | null; team_id: string | null }
        Insert: { code_hash: string; consumed_at?: string | null; created_at?: string; expires_at: string; id?: string; owner_user_id: string; race_id?: string | null; team_id?: string | null }
        Update: { code_hash?: string; consumed_at?: string | null; created_at?: string; expires_at?: string; id?: string; owner_user_id?: string; race_id?: string | null; team_id?: string | null }
        Relationships: []
      }

      simhub_devices: {
        Row: {
          connector_id: string
          device_name: string
          endurance_binding_source: string | null
          endurance_event_id: string | null
          endurance_team_id: string | null
          expires_at: string | null
          id: string
          last_sequence: number
          last_seen_at: string | null
          last_session_id: string | null
          owner_user_id: string
          paired_at: string
          race_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          team_id: string | null
          token_hash: string
          updated_at: string
        }
        Insert: {
          connector_id: string
          device_name: string
          endurance_event_id?: string | null
          endurance_team_id?: string | null
          expires_at?: string | null
          id?: string
          last_sequence?: number
          last_seen_at?: string | null
          last_session_id?: string | null
          owner_user_id: string
          paired_at?: string
          race_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          team_id?: string | null
          token_hash: string
          updated_at?: string
        }
        Update: {
          connector_id?: string
          device_name?: string
          endurance_event_id?: string | null
          endurance_team_id?: string | null
          expires_at?: string | null
          id?: string
          last_sequence?: number
          last_seen_at?: string | null
          last_session_id?: string | null
          owner_user_id?: string
          paired_at?: string
          race_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          team_id?: string | null
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simhub_devices_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simhub_devices_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      simhub_device_sessions: {
        Row: { device_id: string; first_seen_at: string; last_seen_at: string; last_sequence: number; session_id: string }
        Insert: { device_id: string; first_seen_at?: string; last_seen_at?: string; last_sequence: number; session_id: string }
        Update: { device_id?: string; first_seen_at?: string; last_seen_at?: string; last_sequence?: number; session_id?: string }
        Relationships: [{ foreignKeyName: "simhub_device_sessions_device_id_fkey"; columns: ["device_id"]; isOneToOne: false; referencedRelation: "simhub_devices"; referencedColumns: ["id"] }]
      }
      simhub_telemetry_latest: {
        Row: {
          captured_at: string
          car_id: string | null
          car_name: string | null
          connector_id: string
          current_driver_id: string | null
          current_driver_name: string | null
          device_id: string
          driver_id: string | null
          endurance_event_id: string | null
          endurance_team_id: string | null
          game: string
          owner_user_id: string
          race_id: string | null
          received_at: string
          sequence: number
          session_id: string
          simhub_version: string
          team_id: string | null
          telemetry: Json
          track_config: string | null
          track_name: string | null
        }
        Insert: {
          captured_at: string
          car_id?: string | null
          car_name?: string | null
          connector_id: string
          current_driver_id?: string | null
          current_driver_name?: string | null
          device_id: string
          driver_id?: string | null
          endurance_event_id?: string | null
          endurance_team_id?: string | null
          game: string
          owner_user_id: string
          race_id?: string | null
          received_at?: string
          sequence: number
          session_id: string
          simhub_version: string
          team_id?: string | null
          telemetry: Json
          track_config?: string | null
          track_name?: string | null
        }
        Update: {
          captured_at?: string
          car_id?: string | null
          car_name?: string | null
          connector_id?: string
          current_driver_id?: string | null
          current_driver_name?: string | null
          device_id?: string
          driver_id?: string | null
          endurance_event_id?: string | null
          endurance_team_id?: string | null
          game?: string
          owner_user_id?: string
          race_id?: string | null
          received_at?: string
          sequence?: number
          session_id?: string
          simhub_version?: string
          team_id?: string | null
          telemetry?: Json
          track_config?: string | null
          track_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "simhub_telemetry_latest_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "simhub_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simhub_telemetry_latest_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simhub_telemetry_latest_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_memberships: {
        Row: {
          created_at: string
          id: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_memberships_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "confirmed_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "team_memberships_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string
          created_at: string
          description: string | null
          discord_category_id: string | null
          discord_role_id: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          discord_category_id?: string | null
          discord_role_id?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          discord_category_id?: string | null
          discord_role_id?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          iracing_name: string | null
          irating: number | null
          safety_rating: string | null
          team_id: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      confirmed_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          iracing_id: string | null
          iracing_name: string | null
          irating: number | null
          safety_rating: string | null
          team_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      v_3sr_race_eligibility: {
        Row: {
          counts_for_3sr: boolean | null
          dnf_count: number | null
          eligibility_status: string | null
          has_3sr_results: boolean | null
          name: string | null
          race_date: string | null
          race_id: string | null
          total_starters: number | null
          valid_finishers: number | null
          with_irating: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_get_community_support_payment_config: {
        Args: never
        Returns: {
          paypal_enabled: boolean
          paypal_me_url: string
          suggested_amounts_eur: number[]
          payment_admin_discord_id: string
          iracing_referral_enabled: boolean
          iracing_referral_url: string
          paypal_checkout_enabled: boolean
          paypal_checkout_environment: string
        }[]
      }
      admin_set_community_support_paypal_checkout: {
        Args: { p_enabled: boolean; p_environment: string }
        Returns: undefined
      }
      admin_update_community_support_payment_config: {
        Args: {
          p_paypal_enabled: boolean
          p_paypal_checkout_enabled: boolean
          p_paypal_checkout_environment: string
          p_paypal_me_url: string
          p_suggested_amounts_eur: number[]
          p_payment_admin_discord_id: string
          p_iracing_referral_enabled: boolean
          p_iracing_referral_url: string
        }
        Returns: undefined
      }
      create_community_support_payment_intent: {
        Args: {
          p_requested_amount_eur: number
          p_payer_name_private: string
          p_show_supporter_name: boolean
          p_show_amount: boolean
        }
        Returns: string
      }
      create_community_support_paypal_checkout_intent: {
        Args: {
          p_requested_amount_eur: number
          p_payer_name_private: string
          p_show_supporter_name: boolean
          p_show_amount: boolean
        }
        Returns: string
      }
      cancel_community_support_paypal_checkout_intent: {
        Args: { p_intent_id: string }
        Returns: string
      }
      get_community_support_payment_config: {
        Args: never
        Returns: {
          paypal_enabled: boolean
          paypal_me_url: string
          suggested_amounts_eur: number[]
          iracing_referral_enabled: boolean
          iracing_referral_url: string
          paypal_checkout_enabled: boolean
          paypal_checkout_environment: string
        }[]
      }
      get_community_support_paypal_checkout_recovery_intent: {
        Args: never
        Returns: { intent_id: string; status: string }[]
      }
      get_public_community_support_payment_ledger: {
        Args: never
        Returns: {
          id: string
          date: string
          direction: string
          category: string
          description: string
          amount_eur: number | null
          supporter_name: string | null
        }[]
      }
      get_public_community_support_payment_totals: {
        Args: never
        Returns: {
          month: string
          contribution_total_eur: number
          fee_total_eur: number
        }[]
      }
      can_manage_simhub: { Args: never; Returns: boolean }
      is_active_simhub_device: { Args: { p_device_id: string }; Returns: boolean }
      simhub_create_device_pairing_code: {
        Args: { p_code_hash: string; p_expires_at: string; p_owner_user_id: string }
        Returns: boolean
      }
      simhub_create_pairing_code: {
        Args: { p_code_hash: string; p_expires_at: string; p_owner_user_id: string; p_race_id: string; p_team_id: string }
        Returns: boolean
      }
      simhub_exchange_pairing_code: {
        Args: { p_code_hash: string; p_connector_id: string; p_device_name: string; p_token_hash: string }
        Returns: { device_id: string; owner_user_id: string; race_id: string | null; result: string; team_id: string | null }[]
      }
      simhub_revoke_device: { Args: { p_device_id: string; p_revoked_by: string }; Returns: boolean }
      simhub_ingest_snapshot: {
        Args: { p_captured_at: string; p_connector_id: string; p_game: string; p_sequence: number; p_session_id: string; p_simhub_version: string; p_telemetry: Json; p_token_hash: string }
        Returns: { received_at: string | null; result: string }[]
      }
      _3sr_rank_label: {
        Args: { p_race_count: number; p_score: number }
        Returns: string
      }
      admin_delete_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      admin_get_all_profiles: {
        Args: never
        Returns: {
          avatar_url: string | null
          created_at: string
          discord_id: string | null
          display_name: string | null
          id: string
          iracing_id: string | null
          iracing_name: string | null
          irating: number | null
          safety_rating: string | null
          team_id: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_get_user_roles: {
        Args: never
        Returns: {
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      admin_grant_role:
        | {
            Args: {
              target_role: Database["public"]["Enums"]["app_role"]
              target_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: { target_role: string; target_user_id: string }
            Returns: undefined
          }
      admin_revoke_role:
        | {
            Args: {
              target_role: Database["public"]["Enums"]["app_role"]
              target_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: { target_role: string; target_user_id: string }
            Returns: undefined
          }
      discord_claim_token: { Args: { p_token: string }; Returns: string }
      discord_link_account: {
        Args: { p_code: string; p_discord_id: string }
        Returns: string
      }
      discord_register_race: {
        Args: { p_action: string; p_discord_id: string; p_race_id: string }
        Returns: string
      }
      get_driver_sp: {
        Args: { p_league_id?: string; p_user_id: string }
        Returns: number
      }
      get_my_visible_protests: {
        Args: never
        Returns: {
          created_at: string
          description: string | null
          event_name: string
          grid_penalty_places: number | null
          id: string
          lap_number: number | null
          penalty_points: number | null
          penalty_type: string | null
          public_decision: string | null
          race_ban_next: boolean | null
          race_date: string
          status: string
          time_penalty_seconds: number | null
          track: string
          video_link: string | null
          visibility: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      recalculate_3sr_all: { Args: never; Returns: undefined }
      recalculate_3sr_for_race: {
        Args: { p_race_id: string }
        Returns: undefined
      }
      uid: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "super_admin" | "editor" | "tester" | "endurance_manager"
      endurance_availability_type: "available" | "preferred" | "avoid" | "unavailable" | "uncertain"
      endurance_confirmation_status: "unseen" | "viewed" | "accepted" | "change_requested"
      endurance_event_status: "draft" | "registration_open" | "registration_closed" | "planning" | "live" | "completed"
      endurance_event_visibility: "open" | "invite_only" | "hidden"
      endurance_notification_type: "invitation" | "deadline" | "availability_missing" | "team_assigned" | "plan_published" | "plan_changed" | "confirmation_needed" | "stint_soon"
      endurance_registration_status: "interest" | "provisional" | "confirmed" | "reserve" | "rejected" | "withdrawn"
      endurance_stint_status: "draft" | "confirmed" | "ready" | "in_car" | "completed" | "expired" | "replaced"
      endurance_team_role: "manager" | "driver" | "reserve"

    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "super_admin", "editor", "tester", "endurance_manager"],
    },
  },
} as const

