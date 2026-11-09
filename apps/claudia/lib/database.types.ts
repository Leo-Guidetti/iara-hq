// Gerado de wrtrhdrohabspbaxpbeu (schema public) em 09/11/2026 via Supabase generate_typescript_types.
// Na etapa 1 vai para apps/claudia/lib/database.types.ts. Helpers Tables/TablesInsert/TablesUpdate no fim.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.17" }
  public: {
    Tables: {
      activities: {
        Row: { avg_cadence: number | null; avg_hr: number | null; avg_power_w: number | null; created_at: string; details: Json; distance_km: number | null; duration_min: number; elevation_m: number | null; external_id: string | null; id: number; kcal: number | null; kcal_estimated: boolean; load: number | null; local_date: string; max_hr: number | null; notes: string | null; plan_session_id: number | null; rpe: number | null; source: string; sport: string; started_at: string; title: string | null; user_id: string }
        Insert: { avg_cadence?: number | null; avg_hr?: number | null; avg_power_w?: number | null; created_at?: string; details?: Json; distance_km?: number | null; duration_min: number; elevation_m?: number | null; external_id?: string | null; id?: never; kcal?: number | null; kcal_estimated?: boolean; load?: number | null; local_date: string; max_hr?: number | null; notes?: string | null; plan_session_id?: number | null; rpe?: number | null; source?: string; sport: string; started_at?: string; title?: string | null; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["activities"]["Insert"]>
        Relationships: []
      }
      ai_usage: {
        Row: { created_at: string; id: number; input_tokens: number | null; model: string; output_tokens: number | null; route: string; user_id: string }
        Insert: { created_at?: string; id?: never; input_tokens?: number | null; model: string; output_tokens?: number | null; route: string; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["ai_usage"]["Insert"]>
        Relationships: []
      }
      coach_reviews: {
        Row: { created_at: string; decisions: Json; id: number; model: string | null; payload: Json; trigger: string; user_id: string; week_start: string }
        Insert: { created_at?: string; decisions?: Json; id?: never; model?: string | null; payload: Json; trigger?: string; user_id?: string; week_start: string }
        Update: Partial<Database["public"]["Tables"]["coach_reviews"]["Insert"]>
        Relationships: []
      }
      daily_activity: {
        Row: { active_kcal: number | null; exercise_min: number | null; hrv_ms: number | null; local_date: string; resting_hr: number | null; resting_kcal: number | null; sleep_min: number | null; source: string; steps: number | null; updated_at: string; user_id: string }
        Insert: { active_kcal?: number | null; exercise_min?: number | null; hrv_ms?: number | null; local_date: string; resting_hr?: number | null; resting_kcal?: number | null; sleep_min?: number | null; source?: string; steps?: number | null; updated_at?: string; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["daily_activity"]["Insert"]>
        Relationships: []
      }
      diet_recommendations: {
        Row: { created_at: string; id: number; kcal_target: number | null; model: string | null; payload: Json; prompt_version: string | null; protein_g_target: number | null; rationale: string | null; tdee_estimate: number | null; tdee_method: string | null; user_id: string }
        Insert: { created_at?: string; id?: never; kcal_target?: number | null; model?: string | null; payload?: Json; prompt_version?: string | null; protein_g_target?: number | null; rationale?: string | null; tdee_estimate?: number | null; tdee_method?: string | null; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["diet_recommendations"]["Insert"]>
        Relationships: []
      }
      food_logs: {
        Row: { carbs_g: number | null; created_at: string; description: string; eaten_at: string; fat_g: number | null; id: number; kcal: number | null; local_date: string; meal: string | null; protein_g: number | null; source: string; user_id: string }
        Insert: { carbs_g?: number | null; created_at?: string; description: string; eaten_at?: string; fat_g?: number | null; id?: never; kcal?: number | null; local_date: string; meal?: string | null; protein_g?: number | null; source?: string; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["food_logs"]["Insert"]>
        Relationships: []
      }
      ingest_tokens: {
        Row: { created_at: string; id: number; label: string; last_used_at: string | null; revoked_at: string | null; token_hash: string; user_id: string }
        Insert: { created_at?: string; id?: never; label?: string; last_used_at?: string | null; revoked_at?: string | null; token_hash: string; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["ingest_tokens"]["Insert"]>
        Relationships: []
      }
      measurements: {
        Row: { arm_cm: number | null; chest_cm: number | null; created_at: string; hip_cm: number | null; id: number; local_date: string; measured_at: string; neck_cm: number | null; note: string | null; thigh_cm: number | null; user_id: string; waist_cm: number | null }
        Insert: { arm_cm?: number | null; chest_cm?: number | null; created_at?: string; hip_cm?: number | null; id?: never; local_date: string; measured_at?: string; neck_cm?: number | null; note?: string | null; thigh_cm?: number | null; user_id?: string; waist_cm?: number | null }
        Update: Partial<Database["public"]["Tables"]["measurements"]["Insert"]>
        Relationships: []
      }
      medication_logs: {
        Row: { administered_at: string; created_at: string; dose_mg: number; drug: string; id: number; injection_site: string | null; local_date: string; note: string | null; side_effects: string[] | null; user_id: string }
        Insert: { administered_at?: string; created_at?: string; dose_mg: number; drug?: string; id?: never; injection_site?: string | null; local_date: string; note?: string | null; side_effects?: string[] | null; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["medication_logs"]["Insert"]>
        Relationships: []
      }
      photo_reviews: {
        Row: { baseline_date: string | null; bf_high: number | null; bf_low: number | null; confidence: string | null; created_at: string; current_date_ref: string; id: number; input_tokens: number | null; model: string; observations: Json; output_tokens: number | null; photo_ids: number[]; prompt_version: string; protocol_consistent: boolean | null; summary: string | null; user_id: string }
        Insert: { baseline_date?: string | null; bf_high?: number | null; bf_low?: number | null; confidence?: string | null; created_at?: string; current_date_ref: string; id?: never; input_tokens?: number | null; model: string; observations?: Json; output_tokens?: number | null; photo_ids: number[]; prompt_version: string; protocol_consistent?: boolean | null; summary?: string | null; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["photo_reviews"]["Insert"]>
        Relationships: []
      }
      plan_changes: {
        Row: { after: Json | null; before: Json | null; created_at: string; id: number; instruction: string | null; local_date: string | null; plan_id: number | null; scope: string; session_id: number | null; source: string; summary: string; user_id: string }
        Insert: { after?: Json | null; before?: Json | null; created_at?: string; id?: never; instruction?: string | null; local_date?: string | null; plan_id?: number | null; scope: string; session_id?: number | null; source: string; summary: string; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["plan_changes"]["Insert"]>
        Relationships: []
      }
      plan_sessions: {
        Row: { created_at: string; distance_km: number | null; duration_min: number | null; edited: boolean; id: number; intensity: string; local_date: string; origin: string; plan_id: number | null; sport: string; status: string; target: Json; title: string; updated_at: string; user_id: string }
        Insert: { created_at?: string; distance_km?: number | null; duration_min?: number | null; edited?: boolean; id?: never; intensity?: string; local_date: string; origin?: string; plan_id?: number | null; sport: string; status?: string; target?: Json; title: string; updated_at?: string; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["plan_sessions"]["Insert"]>
        Relationships: []
      }
      profiles: {
        Row: { birth_date: string | null; created_at: string; display_name: string | null; enc_version: number; goal: string | null; height_cm: number | null; id: string; sex: string | null; timezone: string; updated_at: string }
        Insert: { birth_date?: string | null; created_at?: string; display_name?: string | null; enc_version?: number; goal?: string | null; height_cm?: number | null; id: string; sex?: string | null; timezone?: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>
        Relationships: []
      }
      progress_photos: {
        Row: { created_at: string; id: number; local_date: string; note: string | null; pose: string; protocol: Json; storage_path: string; taken_at: string; user_id: string }
        Insert: { created_at?: string; id?: never; local_date: string; note?: string | null; pose: string; protocol?: Json; storage_path: string; taken_at?: string; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["progress_photos"]["Insert"]>
        Relationships: []
      }
      training_profiles: {
        Row: { coach_notes: string | null; equipment: string; event: Json | null; ftp_w: number | null; goal: string | null; hr_max: number | null; hr_rest: number | null; limitations: string | null; run_threshold_s_km: number | null; session_minutes: number; sports: Json; swim_css_s_100: number | null; updated_at: string; user_id: string; weekdays: number[] }
        Insert: { coach_notes?: string | null; equipment?: string; event?: Json | null; ftp_w?: number | null; goal?: string | null; hr_max?: number | null; hr_rest?: number | null; limitations?: string | null; run_threshold_s_km?: number | null; session_minutes?: number; sports?: Json; swim_css_s_100?: number | null; updated_at?: string; user_id?: string; weekdays?: number[] }
        Update: Partial<Database["public"]["Tables"]["training_profiles"]["Insert"]>
        Relationships: []
      }
      weekly_checkins: {
        Row: { created_at: string; id: number; model: string; payload: Json; prompt_version: string; score: number | null; user_id: string; week_start: string }
        Insert: { created_at?: string; id?: never; model: string; payload: Json; prompt_version: string; score?: number | null; user_id?: string; week_start: string }
        Update: Partial<Database["public"]["Tables"]["weekly_checkins"]["Insert"]>
        Relationships: []
      }
      weight_entries: {
        Row: { created_at: string; fasted: boolean; id: number; local_date: string; measured_at: string; note: string | null; source: string; user_id: string; weight_kg: number }
        Insert: { created_at?: string; fasted?: boolean; id?: never; local_date: string; measured_at?: string; note?: string | null; source?: string; user_id?: string; weight_kg: number }
        Update: Partial<Database["public"]["Tables"]["weight_entries"]["Insert"]>
        Relationships: []
      }
      workout_logs: {
        Row: { created_at: string; duration_min: number | null; exercise: string; id: number; load_kg: number | null; local_date: string; note: string | null; performed_at: string; plan_id: number | null; plan_session_id: number | null; reps: number | null; rpe: number | null; set_number: number; user_id: string }
        Insert: { created_at?: string; duration_min?: number | null; exercise: string; id?: never; load_kg?: number | null; local_date: string; note?: string | null; performed_at?: string; plan_id?: number | null; plan_session_id?: number | null; reps?: number | null; rpe?: number | null; set_number: number; user_id?: string }
        Update: Partial<Database["public"]["Tables"]["workout_logs"]["Insert"]>
        Relationships: []
      }
      workout_plans: {
        Row: { created_at: string; goal: string | null; id: number; is_active: boolean; materialized_through: string | null; model: string | null; plan: Json; prompt_version: string | null; rationale: string | null; user_id: string; valid_from: string; valid_to: string | null }
        Insert: { created_at?: string; goal?: string | null; id?: never; is_active?: boolean; materialized_through?: string | null; model?: string | null; plan: Json; prompt_version?: string | null; rationale?: string | null; user_id?: string; valid_from?: string; valid_to?: string | null }
        Update: Partial<Database["public"]["Tables"]["workout_plans"]["Insert"]>
        Relationships: []
      }
    }
    Views: {
      body_comp_estimates: { Row: { bf_mean: number | null; bf_navy: number | null; bf_rfm: number | null; fat_mass_kg: number | null; height_cm: number | null; hip_cm: number | null; lean_mass_kg: number | null; local_date: string | null; neck_cm: number | null; sex: string | null; user_id: string | null; waist_cm: number | null; waist_height_ratio: number | null; weight_ref_kg: number | null }; Relationships: [] }
      weight_daily: { Row: { fasted: boolean | null; local_date: string | null; measured_at: string | null; source: string | null; user_id: string | null; weight_kg: number | null }; Relationships: [] }
      weight_with_trend: { Row: { local_date: string | null; n_7d: number | null; trend_7d: number | null; user_id: string | null; weight_kg: number | null }; Relationships: [] }
    }
    Functions: {
      claudia_is_member: { Args: never; Returns: boolean }
      create_ingest_token: { Args: { p_label?: string }; Returns: string }
      ingest_health: { Args: { p_activities?: Json; p_daily?: Json; p_token: string }; Returns: Json }
      ingest_weight: { Args: { p_measured_at?: string; p_source?: string; p_token: string; p_weight_kg: number }; Returns: Json }
      strava_disconnect: { Args: never; Returns: undefined }
      strava_get_tokens: { Args: never; Returns: { access_token: string; athlete_id: number; expires_at: string; last_sync_at: string; refresh_token: string }[] }
      strava_mark_synced: { Args: never; Returns: undefined }
      strava_save_tokens: { Args: { p_access: string; p_athlete_id: number; p_athlete_name: string; p_expires_at: string; p_refresh: string; p_scope: string }; Returns: undefined }
      strava_status: { Args: never; Returns: Json }
      strava_update_tokens: { Args: { p_access: string; p_expires_at: string; p_refresh: string }; Returns: undefined }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database["public"]
export type Tables<T extends keyof (PublicSchema["Tables"] & PublicSchema["Views"])> =
  (PublicSchema["Tables"] & PublicSchema["Views"])[T] extends { Row: infer R } ? R : never
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]

// Valores aceitos pelos CHECKs do banco (não são enums do Postgres; mantidos à mão).
export const CHECKS = {
  food_meal: ["breakfast", "lunch", "dinner", "snack", "shake"],
  food_source: ["manual", "ai_estimate"],
  weight_source: ["manual", "shortcut", "apple_health"],
  photo_pose: ["front", "side", "back"],
  confidence: ["low", "medium", "high"],
  drug: ["tirzepatide", "semaglutide", "other"],
  injection_site: ["abdomen", "thigh", "arm"],
  tdee_method: ["mifflin", "adaptive"],
  sport: ["run", "walk", "hike", "swim", "ride_indoor", "ride_outdoor", "strength", "hiit", "yoga", "mobility", "row", "other"],
  intensity: ["recovery", "easy", "moderate", "tempo", "threshold", "intervals", "long", "strength"],
  session_status: ["planned", "done", "skipped"],
  origin: ["ai", "user"],
  change_scope: ["session", "template", "plan"],
  review_trigger: ["auto", "manual"],
  equipment: ["gym", "home_dumbbells", "bodyweight"],
  activity_source: ["manual", "apple_health", "strava", "shortcut"],
  sex: ["male", "female"],
} as const
