#!/bin/sh
# Dotenv là dữ liệu, không phải chương trình shell. Không eval/source file .env:
# tên shop có khoảng trắng, dấu $ hay backtick không được trở thành lệnh.
env_value() {
  [ -f "${2:-.env}" ] || return 0
  awk -v key="$1" '
    { sub(/\r$/, ""); line=$0 }
    line ~ /^[[:space:]]*#/ { next }
    {
      sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
      pos=index(line, "="); if (!pos) next
      name=substr(line, 1, pos-1); sub(/[[:space:]]+$/, "", name)
      if (name != key) next
      value=substr(line, pos+1); sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+$/, "", value)
      quote=substr(value, 1, 1)
      if ((quote == "\"" || quote == sprintf("%c", 39)) && substr(value, length(value), 1) == quote) {
        value=substr(value, 2, length(value)-2)
      } else { sub(/[[:space:]]+#.*$/, "", value) }
      result=value
    }
    END { printf "%s", result }
  ' "${2:-.env}"
}
