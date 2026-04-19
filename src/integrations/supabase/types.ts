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
          best_lap: string | null
          created_at: string
          dnf: boolean
          fastest_lap: boolean
          gap_to_leader: string | null
          id: string
          incidents: number | null
          iracing_cust_id: string | null
          irating_snapshot: number | null
          laps: number | null
          points: number
          position: number
          race_id: string
          user_id: string
        }
        Insert: {
          best_lap?: string | null
          created_at?: string
          dnf?: boolean
          fastest_lap?: boolean
          gap_to_leader?: string | null
          id?: string
          incidents?: number | null
          iracing_cust_id?: string | null
          irating_snapshot?: number | null
          laps?: number | null
          points?: number
          position: number
          race_id: string
          user_id: string
        }
        Update: {
          best_lap?: string | null
          created_at?: string
          dnf?: boolean
          fastest_lap?: boolean
          gap_to_leader?: string | null
          id?: string
          incidents?: number | null
          iracing_cust_id?: string | null
          irating_snapshot?: number | null
          laps?: number | null
          points?: number
          position?: number
          race_id?: string
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
      races: {
        Row: {
          car: string | null
          counts_for_3sr: boolean
          created_at: string
          id: string
          iracing_session_id: string | null
          league_id: string | null
          name: string
          practice_duration: string | null
          qualifying_duration: string | null
          race_date: string
          race_duration: string | null
          race_type: string | null
          round: number | null
          setup: string | null
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
          league_id?: string | null
          name: string
          practice_duration?: string | null
          qualifying_duration?: string | null
          race_date: string
          race_duration?: string | null
          race_type?: string | null
          round?: number | null
          setup?: string | null
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
          league_id?: string | null
          name?: string
          practice_duration?: string | null
          qualifying_duration?: string | null
          race_date?: string
          race_duration?: string | null
          race_type?: string | null
          round?: number | null
          setup?: string | null
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
      app_role: "admin" | "moderator" | "user" | "super_admin"
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
      app_role: ["admin", "moderator", "user", "super_admin"],
    },
  },
} as const

