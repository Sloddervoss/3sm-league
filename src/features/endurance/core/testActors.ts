/**
 * Test-actors voor de Endurance-canary (super-admin-only).
 *
 * Omdat de RLS alleen controleert of de *sessie* super-admin is (niet of de
 * `user_id` in een rij gelijk is aan `auth.uid()`), kan de super-admin veilig
 * writes doen met een andere `user_id`. Dat gebruiken we om de hele flow als
 * verschillende coureurs te testen, zonder echte accounts te maken die op de
 * live site zouden verschijnen.
 *
 * Dit zijn VASTE, vooraf gekozen UUID's — géén echte auth.users / profiles.
 * Ze worden alléén binnen de endurance-databank gebruikt.
 */
export interface EnduranceTestActor {
  /** Vast user_id dat als `user_id` in endurance-_tabellen wordt geschreven. */
  id: string;
  /** Tonenlabel in de Test-als-slider. */
  label: string;
  role: "driver" | "reserve";
}

export const ENDURANCE_TEST_ACTORS: EnduranceTestActor[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", label: "Coureur A", role: "driver" },
  { id: "00000000-0000-4000-8000-0000000000a2", label: "Coureur B", role: "driver" },
  { id: "00000000-0000-4000-8000-0000000000a3", label: "Coureur C", role: "driver" },
  { id: "00000000-0000-4000-8000-0000000000a4", label: "Coureur D", role: "reserve" },
];
