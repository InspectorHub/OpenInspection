// The one place this codebase imports the MCP server SDK from. A package
// rename or a v2 minor that moves an export is then a one-file change, and
// nothing under server/ reaches into the package by itself.
export { McpServer, ResourceTemplate, ProtocolError, ProtocolErrorCode, localhostAllowedOrigins } from '@modelcontextprotocol/server';
