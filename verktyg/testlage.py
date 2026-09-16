# -*- coding: utf-8 -*-
"""Testläge: kör sajten lokalt med påhittad data i stället för Supabase.

Startas med "Starta testläge.bat". Öppna http://localhost:8001

Sidan / serverar index.html, men med Supabase-biblioteket utbytt mot
verktyg/mock-supabase.js. Allt annat serveras från projektmappen, utan
cache, så att en sparad ändring syns direkt vid omladdning.
"""
import http.server
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
PORT = 8001
CDN = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js"></script>'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PROJECT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?')[0].split('#')[0]
        if path in ('/', '/index.html'):
            with open(os.path.join(PROJECT, 'index.html'), encoding='utf-8') as f:
                html = f.read()
            if CDN not in html:
                self.send_error(500, 'Hittade inte Supabase-skriptet i index.html. Har versionen bytts? Uppdatera CDN i verktyg/testlage.py.')
                return
            body = html.replace(CDN, '<script src="/verktyg/mock-supabase.js"></script>').encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print('Testläge körs på http://localhost:%d' % PORT)
    print('Påhittad data, ingen riktig databas. Stäng fönstret för att avsluta.')
    try:
        http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
    except OSError:
        print('Porten %d är upptagen. Är testläget redan igång i ett annat fönster?' % PORT)
        input('Tryck Enter för att stänga.')
        sys.exit(1)
