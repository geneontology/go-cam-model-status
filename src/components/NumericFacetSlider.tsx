import { RangeSlider } from "@mantine/core";
import React, { useEffect } from "react";
import type { NumericFacet, NumericFilter } from "../hooks/useFacets.ts";

interface NumericFacetSliderProps {
  field: string;
  facet: NumericFacet;
  activeFilter?: NumericFilter;
  onClearAll: () => void;
  onChange: (field: string, min: number, max: number) => void;
}

const NumericFacetSlider: React.FC<NumericFacetSliderProps> = ({
  field,
  facet,
  activeFilter,
  onClearAll,
  onChange,
}) => {
  const [value, setValue] = React.useState<[number, number]>([0, 0]);

  useEffect(() => {
    if (activeFilter && activeFilter.min != null && activeFilter.max != null) {
      // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
      setValue([activeFilter.min, activeFilter.max]);
    } else if (facet && Array.isArray(facet.values)) {
      // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
      setValue([facet.values[0], facet.values[1]]);
    }
  }, [activeFilter, facet]);

  const handleChange = (value: [number, number]) => {
    if (value[0] === facet.values[0] && value[1] === facet.values[1]) {
      onClearAll();
    } else {
      onChange(field, value[0], value[1]);
    }
  };

  return (
    <RangeSlider
      mx="xs"
      mb="xl"
      min={facet.values[0]}
      max={facet.values[1]}
      step={1}
      minRange={0}
      pushOnOverlap={false}
      value={value}
      onChange={setValue}
      onChangeEnd={handleChange}
      marks={[
        {
          value: facet.values[0],
          label: String(facet.values[0]),
        },
        {
          value: facet.values[1],
          label: String(facet.values[1]),
        },
      ]}
    />
  );
};

export default NumericFacetSlider;
