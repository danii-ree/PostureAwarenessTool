#pragma once
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

// Decode a complete bounded HTTP response; never accept a partial settings body.
inline int decodeHttp(char *raw, size_t len, char *out, size_t cap, bool closed) {
  if (!cap) return -2;
  out[0] = 0;
  char *end = raw + len, *body = strstr(raw, "\r\n\r\n");
  if (!body || strncmp(raw, "HTTP/1.", 7) || len < 12) return -2;
  int status = atoi(raw + 9);
  bool chunked = false; long contentLength = -1;
  for (char *p = strstr(raw, "\r\n") + 2; p < body;) {
    char *next = strstr(p, "\r\n");
    if (!next) return -2;
    // Header names and transfer coding are case insensitive.
    for (char *q = p; q < next; ++q) *q = tolower((unsigned char)*q);
    if (!strncmp(p, "transfer-encoding:", 18)) {
      char *value = p + 18; while (*value == ' ') ++value;
      if (strncmp(value, "chunked", 7) || value + 7 != next) return -2;
      chunked = true;
    }
    if (!strncmp(p, "content-length:", 15)) {
      char *value = p + 15, *tail;
      contentLength = strtol(value, &tail, 10);
      if (tail == value || tail != next || contentLength < 0) return -2;
    }
    p = next + 2;
  }
  body += 4;
  size_t used = 0;
  if (chunked) {
    if (contentLength >= 0) return -2;
    for (;;) {
      char *line = strstr(body, "\r\n"), *tail;
      if (!line || body == line || !isxdigit((unsigned char)*body)) return -2;
      unsigned long count = strtoul(body, &tail, 16);
      if (tail != line && *tail != ';') return -2;
      body = line + 2;
      if (!count) {
        if (end - body < 2 || body[0] != '\r' || body[1] != '\n') return -2;
        out[used] = 0; return status;
      }
      if (count >= cap - used || count > (size_t)(end - body) || (size_t)(end - body) - count < 2) return -2;
      memcpy(out + used, body, count); used += count; body += count;
      if (body[0] != '\r' || body[1] != '\n') return -2;
      body += 2;
    }
  }
  size_t count = contentLength >= 0 ? (size_t)contentLength : (size_t)(end - body);
  if ((contentLength < 0 && !closed) || count > (size_t)(end - body) || count >= cap) return -2;
  memcpy(out, body, count); out[count] = 0; return status;
}
