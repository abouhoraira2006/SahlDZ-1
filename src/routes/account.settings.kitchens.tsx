import { createFileRoute } from "@tanstack/react-router";
import { KitchensSettingsPageView } from "@/pages/settings-views/KitchensSettingsPageView";

export const Route = createFileRoute("/account/settings/kitchens")({
  component: KitchensSettingsPageView,
});
