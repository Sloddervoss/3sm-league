import type { EnduranceRegistration } from "./types";
import type { EnduranceClassId } from "./carCatalog";
import { getEnduranceCar } from "./carCatalog";

export interface VoteResult {
  id: string;
  votes: number;
  percentage: number;
}

const included = (registration: EnduranceRegistration) => !["withdrawn", "rejected"].includes(registration.status);

const tally = (ids: string[], total: number): VoteResult[] => {
  const counts = ids.reduce<Record<string, number>>((result, id) => ({ ...result, [id]: (result[id] ?? 0) + 1 }), {});
  return Object.entries(counts)
    .map(([id, votes]) => ({ id, votes, percentage: total ? Math.round((votes / total) * 100) : 0 }))
    .sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
};

export const getEventVehicleVotes = (registrations: EnduranceRegistration[], eventId: string) => {
  const voters = registrations.filter((registration) => registration.eventId === eventId && included(registration));
  const classVotes = tally(voters.map((registration) => registration.classPreference), voters.length);
  const carVotes = tally(voters.map((registration) => registration.preferredCarId), voters.length);
  return { totalVoters: voters.length, classVotes, carVotes };
};

export const uniqueWinner = (votes: VoteResult[]) => {
  if (!votes.length || (votes[1] && votes[0].votes === votes[1].votes)) return null;
  return votes[0].id;
};

const leadingIds = (votes: VoteResult[]) => votes.length ? votes.filter((vote) => vote.votes === votes[0].votes).map((vote) => vote.id) : [];

export const winningClassIds = (registrations: EnduranceRegistration[], eventId: string) => leadingIds(getEventVehicleVotes(registrations, eventId).classVotes) as EnduranceClassId[];

export const winningCarIdsForClass = (registrations: EnduranceRegistration[], eventId: string, classId: EnduranceClassId) => {
  const votes = getEventVehicleVotes(registrations, eventId).carVotes.filter((vote) => getEnduranceCar(vote.id)?.classId === classId);
  return leadingIds(votes);
};

export const isWinningVehicleSelection = (registrations: EnduranceRegistration[], eventId: string, classId: EnduranceClassId, carId: string) => {
  const classWinners = winningClassIds(registrations, eventId);
  if (classWinners.length && !classWinners.includes(classId)) return false;
  const carWinners = winningCarIdsForClass(registrations, eventId, classId);
  return !carWinners.length || carWinners.includes(carId);
};

export const recommendedVehicle = (registrations: EnduranceRegistration[], eventId: string) => {
  const votes = getEventVehicleVotes(registrations, eventId);
  const classId = uniqueWinner(votes.classVotes) as EnduranceClassId | null;
  if (!classId) return { classId: null, carId: null, tied: votes.classVotes.length > 1 && votes.classVotes[0].votes === votes.classVotes[1].votes };
  const classCarVotes = votes.carVotes.filter((vote) => getEnduranceCar(vote.id)?.classId === classId);
  const carId = uniqueWinner(classCarVotes);
  return { classId, carId, tied: Boolean(classCarVotes[1] && classCarVotes[0].votes === classCarVotes[1].votes) };
};
