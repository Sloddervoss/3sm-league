# Endurance beta label

The shared `EnduranceBetaBadge` adds a compact orange label to desktop/mobile navigation, the footer link and the Endurance section heading. The label is non-interactive, remains readable on active menu backgrounds and does not change access rights or role assignments.

Full navigation starts at 1800px and uses a wider header with compact links so staff account controls stay reachable alongside the beta badge. Smaller screens retain the existing expandable menu; its content scrolls within the viewport on short screens.

Opening the beta requires a separate access release. Module discovery, event visibility, participant access and manager actions must remain distinct. Never replace `is_endurance_staff` with an all-members predicate: existing policies can expose private race data through that helper. Reconcile deployed participant policies, capabilities, device ownership and realtime restrictions before retiring Tester assignments.
