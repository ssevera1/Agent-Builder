#!/usr/bin/env node
/**
 * AgentBuilder CLI entry point.
 *
 * Loads environment variables from .env and runs the CLI program.
 */

import dotenv from 'dotenv';
import { createProgram } from '../index.js';

// Load .env from the current working directory
dotenv.config();

const program = createProgram();
program.parse();
