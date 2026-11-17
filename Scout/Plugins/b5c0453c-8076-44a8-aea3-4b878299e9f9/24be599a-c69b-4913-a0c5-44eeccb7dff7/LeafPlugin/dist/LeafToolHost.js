// Module singleton shared between the LEAF panel and the ChatTool: Lens Studio
// loads them as separate plugin instances from the same JS module, so this is
// how the tool finds the panel's live ViewModel without duplicating the
// message-broker plumbing.
let activeViewModel = null;
export function setActiveViewModel(viewModel) {
    activeViewModel = viewModel;
}
export function getActiveViewModel() {
    return activeViewModel;
}
