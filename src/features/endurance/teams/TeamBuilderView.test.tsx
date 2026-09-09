import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TeamBuilderView } from "./TeamBuilderView";
import { workflowEvent, workflowFixture, workflowNames } from "./teamWorkflow.fixture";
afterEach(cleanup);
const props=()=>({event:workflowEvent,snapshot:structuredClone(workflowFixture),displayName:(id:string)=>workflowNames[Number(id)] ?? id,managerId:"manager",onApply:vi.fn().mockResolvedValue(undefined),onManage:vi.fn().mockResolvedValue(undefined)});
it("previews mixed pace teams without writing and confirms the exact reviewed proposal",async()=>{
 const p=props();render(<TeamBuilderView {...p}/>);
 fireEvent.click(screen.getByRole("button",{name:"Teams voorstellen"}));
 expect(p.onApply).not.toHaveBeenCalled();
 expect(screen.getByText("3 nieuwe teams")).toBeInTheDocument();
 expect(screen.getByLabelText("Naam team 1")).toHaveValue("Team 1");
 fireEvent.change(screen.getByLabelText("Naam team 1"),{target:{value:"Orange Racing"}});
 fireEvent.click(screen.getByRole("button",{name:"Deze teams opslaan"}));
 expect(p.onApply).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({name:"Orange Racing",capacity:4}),expect.objectContaining({capacity:6}),expect.objectContaining({capacity:8})]),"revision-1");
 expect(await screen.findByText(/Teams opgeslagen/)).toBeInTheDocument();
});
it("blocks a stale preview instead of silently applying changed inputs",()=>{
 const p=props();const view=render(<TeamBuilderView {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Teams voorstellen"}));
 view.rerender(<TeamBuilderView {...p} snapshot={{...p.snapshot,revision:"revision-2"}}/>);
 expect(screen.getByRole("button",{name:"Deze teams opslaan"})).toBeDisabled();
 expect(screen.getByRole("alert")).toHaveTextContent("Gegevens zijn veranderd");
});
it("keeps the proposal after a failed save and presents the server error",async()=>{
 const p=props();p.onApply.mockRejectedValue(new Error("Team is inmiddels gewijzigd"));render(<TeamBuilderView {...p}/>);
 fireEvent.click(screen.getByRole("button",{name:"Teams voorstellen"}));fireEvent.click(screen.getByRole("button",{name:"Deze teams opslaan"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Team is inmiddels gewijzigd");expect(screen.getByLabelText("Naam team 1")).toBeInTheDocument();
});
it("edits the capacity and manager of an existing team in an accessible dialog",async()=>{
 const p=props();p.snapshot.data.teams=[{id:"t",event_id:workflowEvent.id,name:"Orange",car_id:workflowEvent.selectedCarId,car_number:"31",manager_id:"manager",livery:null,created_at:"",updated_at:"",target_size:4}];
 render(<TeamBuilderView {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Instellingen Orange"}));
 const dialog=screen.getByRole("dialog");fireEvent.change(within(dialog).getByLabelText("Teamgrootte"),{target:{value:"8"}});fireEvent.click(within(dialog).getByRole("button",{name:"Opslaan"}));
 expect(p.onManage).toHaveBeenCalledWith(expect.objectContaining({kind:"settings",team_id:"t",capacity:8}),"revision-1");
 expect(await screen.findByText("Teaminstellingen opgeslagen.")).toBeInTheDocument();
});
