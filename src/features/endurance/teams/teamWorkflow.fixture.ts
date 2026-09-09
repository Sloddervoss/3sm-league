import { createEnduranceSeed } from "../core/seed";
import type { TeamWorkflowSnapshot } from "../repository/teamWorkflowRepository";
export const workflowEvent = {...createEnduranceSeed().events[0], name:"24 Hours · Spa", startAt:"2026-10-10T12:00:00.000Z",endAt:"2026-10-11T12:00:00.000Z",maxDriversPerCar:16};
export const workflowNames = ["Vincent de Vos","Jaimy Peters","Sven Bakker","Ricky Janssen","Lars de Vries","Milan Visser","Thomas Smit","Daan de Jong","Bram van Dijk","Niels Meijer","Jesse Mulder","Tim van Leeuwen","Nick Bos","Mark Hendriks","Ruben de Groot","Bas van Dam","Kevin Willems","Sam Peters"];
export const workflowFixture: TeamWorkflowSnapshot = {revision:"revision-1",data:{
 teams:[],members:[],
 registrations:workflowNames.map((_,i)=>({id:`r${i}`,event_id:workflowEvent.id,user_id:String(i),status:"provisional",class_preference:null,preferred_car_id:null,slot_id:null,max_stints:null,max_stint_minutes:null,max_total_minutes:i<4?360:i<10?240:180,max_consecutive_stints:null,min_rest_minutes:60,night_driving:true,willing_to_start:i===0,willing_to_finish:false,notes:null,registered_at:workflowEvent.startAt,preferred_team_size:i<4?4:i<10?6:8,team_approach:i<4?"competitive":i<10?"either":"fun"})),
 pace:workflowNames.map((_,i)=>({id:`p${i}`,event_id:workflowEvent.id,user_id:String(i),circuit:workflowEvent.circuit,configuration:workflowEvent.configuration,car:workflowEvent.selectedCarId!,conditions:"dry",average_lap_seconds:123+i*.12,median_lap_seconds:123+i*.12,best_lap_seconds:122+i*.12,best_five_average_seconds:122.5+i*.12,consistency_seconds:.5,valid_laps:24,incidents:0,average_stint_minutes:50,recorded_at:workflowEvent.startAt,source:"practice",notes:null})),
 availability:workflowNames.map((_,i)=>({id:`a${i}`,event_id:workflowEvent.id,user_id:String(i),start_at:workflowEvent.startAt,end_at:workflowEvent.endAt,type:"available",note:null})),
}};
