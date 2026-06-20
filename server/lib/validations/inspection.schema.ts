// Re-export barrel — kept so existing `validations/inspection.schema` imports
// resolve unchanged after the schemas were split into validations/inspection/
// {crud,read,write,auxiliary}.ts. New code may import from either path.
export * from './inspection/crud';
export * from './inspection/read';
export * from './inspection/write';
export * from './inspection/auxiliary';
