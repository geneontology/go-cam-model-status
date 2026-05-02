import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ResultsDisplayType } from "../types.ts";
import { config } from "../config.tsx";

type FieldKey = string;

type UserSettingsState = {
  visibleFields: FieldKey[];
  resultsDisplayType: ResultsDisplayType;
  toggleField: (field: FieldKey) => void;
  setResultsDisplayType: (type: ResultsDisplayType) => void;
};

export const useUserSettings = create<UserSettingsState>()(
  persist(
    (set) => ({
      visibleFields: config.fields
        .filter((field) => field.defaultVisible)
        .map((field) => String(field.field)),
      resultsDisplayType: ResultsDisplayType.CARDS,
      toggleField: (field) =>
        set((state) => ({
          visibleFields: state.visibleFields.includes(field)
            ? state.visibleFields.filter((f) => f !== field)
            : [...state.visibleFields, field],
        })),
      setResultsDisplayType: (type) => set({ resultsDisplayType: type }),
    }),
    {
      name: "GO_CAM_MODEL_STATUS_USER_SETTINGS",
      version: 1,
    },
  ),
);

export default useUserSettings;
