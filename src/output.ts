import Table from "cli-table3";
import YAML from "yaml";
import pc from "yoctocolors";
import type { GlobalOptions, OutputFormat } from "./types.js";

export type TableColumn<T> = {
  header: string;
  value: (item: T) => unknown;
};

export function resolveOutput(options: GlobalOptions): OutputFormat {
  if (options.json) {
    return "json";
  }

  const configured = (options.output ?? process.env.MCPSTACK_OUTPUT ?? "table").toLowerCase();
  if (configured === "json" || configured === "yaml" || configured === "table") {
    return configured;
  }

  return "table";
}

export function printData<T>(data: T, options: GlobalOptions, columns?: TableColumn<any>[]): void {
  const output = resolveOutput(options);
  if (output === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (output === "yaml") {
    console.log(YAML.stringify(data));
    return;
  }

  if (Array.isArray(data)) {
    printArrayTable(data, columns);
    return;
  }

  if (columns && data && typeof data === "object") {
    printArrayTable([data], columns);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

export function printInfo(message: string): void {
  console.log(pc.cyan(message));
}

export function printSuccess(message: string): void {
  console.log(pc.green(message));
}

export function printWarning(message: string): void {
  console.error(pc.yellow(message));
}

export function printError(message: string): void {
  console.error(pc.red(message));
}

function printArrayTable(items: any[], columns?: TableColumn<any>[]): void {
  if (items.length === 0) {
    console.log("No results.");
    return;
  }

  const effectiveColumns = columns ?? Object.keys(items[0]).slice(0, 6).map((key) => ({
    header: key,
    value: (item: any) => item[key],
  }));

  const table = new Table({
    head: effectiveColumns.map((column) => column.header),
    wordWrap: true,
  });

  for (const item of items) {
    table.push(effectiveColumns.map((column) => formatCell(column.value(item))));
  }

  console.log(table.toString());
}

function formatCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
