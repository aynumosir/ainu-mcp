"""ainu_mcp — Python data loaders for the Ainu toolchain.

This package no longer ships an MCP server (the hosted Cloudflare Worker in
``worker/`` is the single MCP surface). What remains are the corpus / dictionary
/ grammar / glossary loaders that ``etl/build_d1.py`` imports to build the
Worker's D1 reference database.
"""
