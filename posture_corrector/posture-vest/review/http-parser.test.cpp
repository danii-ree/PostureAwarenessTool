#include "../firmware/posture_vest/http_response.h"
#include <assert.h>
#include <stdio.h>
#include <string>
#include <fstream>
#include <iterator>
int main(int argc, char **argv) {
 char out[400], raw[1600];
 auto check = [&](const std::string &s, int expected, const char *body = nullptr, bool closed = true, size_t cap = 400) {
  strcpy(raw, s.c_str()); int result = decodeHttp(raw, s.size(), out, cap, closed); assert(result == expected); if (body) assert(!strcmp(out, body));
 };
 check("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nto\r\n4\r\nl=12\r\n1\r\n\n\r\n0\r\n\r\n",200,"tol=12\n",false);
 check("HTTP/1.1 200 OK\r\ntransfer-encoding: Chunked\r\n\r\n6;ext=1\r\nen=0\nX\r\n0\r\n\r\n",200,"en=0\nX");
 check("HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nen=0",200,"en=0",false);
 check("HTTP/1.1 200 OK\r\n\r\nen=0",200,"en=0");
 check("HTTP/1.1 200 OK\r\n\r\nen=0",-2,nullptr,false);
 check("HTTP/1.1 200 OK\r\nContent-Length: 99\r\n\r\nen=0",-2);
 check("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nen=0\r\n",-2);
 check("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzzz\r\n",-2);
 check("HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nen=0",-2,nullptr,true,4);
 check("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nen=0\r\n0\r\n\r\n",-2,nullptr,true,4);
 check("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n",-2);
 check("HTTP/1.1 200 OK\r\nContent-Length: 399\r\n\r\n" + std::string(399, 'x'),200,std::string(399, 'x').c_str());
 check("HTTP/1.1 200 OK\r\nContent-Length: 400\r\n\r\n" + std::string(400, 'x'),-2);
 if (argc > 1) {
  std::ifstream file(argv[1], std::ios::binary);
  std::string captured((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
  assert(file.good() || file.eof()); assert(!captured.empty());
  check(captured,200,"tol=12\ndelay=4\nint=150\nen=1\nrecal=0\n");
 }
 puts("PASS: 13 HTTP parser cases plus captured Next.js chunked response");
}
