"""
Makes PyMySQL (a pure-Python MySQL driver, no C compiler needed)
act as a drop-in replacement for mysqlclient, which Django's
'django.db.backends.mysql' engine normally expects.

This is here so `pip install` doesn't require a C compiler and
MySQL header files on your machine — a common source of setup
pain on Windows in particular.
"""
import pymysql

pymysql.install_as_MySQLdb()
