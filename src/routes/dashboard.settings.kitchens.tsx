import { createFileRoute } from "@tanstack/react-router";
import { KitchensSettingsPageView } from "@/pages/settings-views/KitchensSettingsPageView";

export const Route = createFileRoute("/dashboard/settings/kitchens")({
  component: KitchensSettingsPageView,
});
