import { ShieldCheck, UserRound } from "lucide-react";
import { useEnduranceActor } from "../core/ActorContext";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Test-als slider — super-admin-only canary.
 * Kiest met welke coureur de super-admin inschrijft/werkt. De RLS checkt alleen
 * de sessie (super-admin), dus de geselecteerde actor-id kan veilig als user_id
 * worden gebruikt zonder echte accounts op de live site te tonen.
 */
export const DevPersonaBar = () => {
  const { user } = useAuth();
  const { actorId, setActorId, displayName, testActors } = useEnduranceActor();

  return (
    <div className="rounded-2xl bg-sky-500/[0.07] p-3 ring-1 ring-sky-400/20">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-sky-100">
          <ShieldCheck className="h-4 w-4 text-sky-300" />
          <div><strong>Super-admin canary</strong><span className="ml-2 text-sky-200/65">Testomgeving · alleen super-admin zichtbaar.</span></div>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-sky-100">
          <UserRound className="h-4 w-4 text-sky-300" />
          Schrijf als
          <select
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            className="h-9 rounded-lg bg-black/35 px-3 text-sm text-white ring-1 ring-white/10"
          >
            <option value={user?.id}>{displayName(user?.id ?? "")}</option>
            {testActors.map((actor) => (
              <option key={actor.id} value={actor.id}>{actor.label} · {actor.role === "reserve" ? "Reserve" : "Coureur"}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};
