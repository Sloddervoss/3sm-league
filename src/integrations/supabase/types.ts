export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      teams: {
        Row: {
          id: string
          name: string
          logo_url: string | null
          color: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          logo_url?: string | null
          color?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          logo_url?: string | null
          color?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_memberships: {
        Row: {
          id: string
          user_id: string
          team_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          team_id: string
          role?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          team_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      protests: {
        Row: {
          id: string
          race_id: string
          reporter_user_id: string
          accused_user_id: string
          lap_number: number | null
          description: string
          video_link: string | null
          status: string
          steward_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          race_id: string
          reporter_user_id: string
          accused_user_id: string
          lap_number?: number | null
          description: string
          video_link?: string | null
          status?: string
          steward_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          race_id?: string
          reporter_user_id?: string
          accused_user_id?: string
          lap_number?: number | null
          description?: string
          video_link?: string | null
          status?: string
          steward_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      penalties: {
        Row: {
          id: string
          protest_id: string | null
          race_id: string
          user_id: string
          penalty_type: string
          time_penalty_seconds: number | null
          points_deduction: number | null
          reason: string
          applied_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          protest_id?: string | null
          race_id: string
          user_id: string
          penalty_type: string
          time_penalty_seconds?: number | null
          points_deduction?: number | null
          reason: string
          applied_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          protest_id?: string | null
          race_id?: string
          user_id?: string
          penalty_type?: string
          time_penalty_seconds?: number | null
          points_deduction?: number | null
          reason?: string
          applied_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      points_config: {
        Row: {
          id: string
          league_id: string
          position: number
          points: number
        }
        Insert: {
          id?: string
          league_id: string
          position: number
          points: number
        }
        Update: {
          id?: string
          league_id?: string
          position?: number
          points?: number
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          iracing_id: string | null
          iracing_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          iracing_id?: string | null
          iracing_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          iracing_id?: string | null
          iracing_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      race_registrations: {
        Row: {
          created_at: string
          id: string
          race_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          race_id: string
          status?: string
          user_id: string
        }
        Update: {
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
        ]
      }
      race_results: {
        Row: {
          created_at: string
          dnf: boolean
          fastest_lap: boolean
          gap_to_leader: string | null
          id: string
          points: number
          position: number
          race_id: string
          user_id: string
          laps: number | null
          best_lap: string | null
          incidents: number | null
          iracing_cust_id: string | null
        }
        Insert: {
          created_at?: string
          dnf?: boolean
          fastest_lap?: boolean
          gap_to_leader?: string | null
          id?: string
          points?: number
          position: number
          race_id: string
          user_id: string
          laps?: number | null
          best_lap?: string | null
          incidents?: number | null
          iracing_cust_id?: string | null
        }
        Update: {
          created_at?: string
          dnf?: boolean
          fastest_lap?: boolean
          gap_to_leader?: string | null
          id?: string
          points?: number
          position?: number
          race_id?: string
          user_id?: string
          laps?: number | null
          best_lap?: string | null
          incidents?: number | null
          iracing_cust_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          created_at: string
          id: string
          league_id: string
          name: string
          race_date: string
          round: number
          status: string
          track: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          name: string
          race_date: string
          round: number
          status?: string
          track: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          name?: string
          race_date?: string
          round?: number
          status?: string
          track?: string
          updated_at?: string
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
