#!/bin/bash
# Stands in for the memory-cap wrapper:  bounded --want <MB> -- <command...>   Records its arguments, then runs the command.
echo "$@" >> "$FAKE_LOG"
shift 3
exec "$@"
