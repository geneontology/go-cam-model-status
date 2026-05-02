import { useDisclosure } from "@mantine/hooks";
import {
  Alert,
  AppShell,
  Burger,
  Divider,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useEffect, useMemo, useRef } from "react";
import { InfoIcon } from "@phosphor-icons/react";
import { HEADER_HEIGHT, NAVBAR_WIDTH } from "./constants.ts";
import useFacets from "./hooks/useFacets.ts";
import Facet from "./components/Facet.tsx";
import useSearch from "./hooks/useSearch.ts";
import useQueryData from "./hooks/useQueryData.ts";
import SearchInput from "./components/SearchInput.tsx";
import Header from "./components/Header.tsx";
import UserSettingsMenu from "./components/UserSettingsMenu.tsx";
import HeaderLinks from "./components/HeaderLinks.tsx";
import Footer from "./components/Footer.tsx";
import ResultsDisplay from "./components/ResultsDisplay.tsx";
import ModelDetail from "./components/ModelDetail.tsx";
import { useUrlState, useSelectedModel } from "./hooks/useUrlState.ts";
import { buildExtendedFields, flattenChecks } from "./runtimeFields.ts";

import classes from "./App.module.css";

function ScrollAreaWrapper({ children }: { children: React.ReactNode }) {
  return <ScrollArea offsetScrollbars>{children}</ScrollArea>;
}

function App() {
  const [opened, { toggle }] = useDisclosure();
  const targetRef = useRef<HTMLDivElement>(null);
  const [selectedModel, setSelectedModel] = useSelectedModel();

  const { isPending, isError, data, error } = useQueryData();

  // Build the runtime field list once the manifest is in.
  const fields = useMemo(
    () => buildExtendedFields(data?.manifest),
    [data?.manifest],
  );

  // Pre-flatten so per-check facets read like normal text fields.
  const flatModels = useMemo(
    () => (data ? flattenChecks(data.models) : []),
    [data],
  );

  const { search, setSearch, filters, setFilters } = useUrlState(fields);

  const { results: searchResults, isIndexing } = useSearch({
    data: flatModels,
    fields,
    query: search,
  });

  const {
    facets,
    toggleFacet,
    clearAllFacets,
    clearFacet,
    matchingIndexes,
    activeFilters,
    setNumericRange,
  } = useFacets({
    data: searchResults,
    fields,
    activeFilters: filters,
    setActiveFilters: setFilters,
  });

  useEffect(() => {
    if (targetRef.current) {
      targetRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeFilters]);

  const facetFields = useMemo(() => fields.filter((f) => f.facet), [fields]);

  const handleSelectModel = (id: string) => {
    void setSelectedModel(id);
  };
  const handleCloseDetail = () => {
    void setSelectedModel("");
  };

  return (
    <AppShell
      header={{ height: HEADER_HEIGHT }}
      navbar={{
        width: NAVBAR_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header className={classes.header}>
        <Burger
          opened={opened}
          onClick={toggle}
          className={classes.burger}
          size="sm"
        />
        <Header />
      </AppShell.Header>
      <AppShell.Navbar className={classes.navbar}>
        <AppShell.Section grow component={ScrollAreaWrapper}>
          <Stack className={classes.smallScreenHeaderLinks} gap="xs">
            <HeaderLinks />
            <Divider />
          </Stack>
          <Stack gap="md" mt="md">
            {facetFields.map((field) => (
              <Facet
                key={String(field.field)}
                field={field}
                facet={facets[String(field.field)]}
                onClearAll={() => clearFacet(String(field.field))}
                onFacetClick={toggleFacet}
                activeFilter={activeFilters[String(field.field)]}
                onNumericRangeChange={setNumericRange}
              />
            ))}
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>
      <div ref={targetRef} />
      <AppShell.Main className={classes.main}>
        <div className={classes.mainContent}>
          <Alert
            variant="light"
            color="secondary"
            icon={<InfoIcon size={18} />}
            mb="md"
          >
            This is an internal status page for the low-level Noctua storage
            layer for GO-CAMs in OWL/RDF.
          </Alert>
          <Group align="center" mb="md">
            <SearchInput
              value={search}
              onSearch={setSearch}
              disabled={isIndexing || isPending}
            />
            <UserSettingsMenu fields={fields} />
          </Group>
          {isPending && (
            <Group align="center" gap="sm" mb="md">
              <Loader size="sm" />
              <Text>Loading...</Text>
            </Group>
          )}
          {isError && (
            <Alert color="red" title="Error" mb="md">
              Something went wrong: {error.message}
            </Alert>
          )}
          {!isPending && !isError && data && (
            <Group mb="md" justify="space-between">
              <Text>
                Found <b>{matchingIndexes.length ?? 0}</b> models
              </Text>
              {Object.keys(activeFilters).length > 0 && (
                <UnstyledButton onClick={clearAllFacets}>
                  <Text size="sm" c="primary">
                    Clear all filters
                  </Text>
                </UnstyledButton>
              )}
            </Group>
          )}
          {data && (
            <ResultsDisplay
              data={searchResults}
              displayIndexes={matchingIndexes}
              manifest={data.manifest}
              onSelectModel={handleSelectModel}
              fields={fields}
            />
          )}
        </div>
        <Footer />
      </AppShell.Main>
      <ModelDetail
        modelId={selectedModel}
        manifest={data?.manifest}
        onClose={handleCloseDetail}
      />
    </AppShell>
  );
}

export default App;
