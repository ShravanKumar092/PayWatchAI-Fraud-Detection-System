from .security_v2 import create_access_token, verify_token


def create_token(email, role):
    return create_access_token({"email": email, "role": role})


def decode_token(token):
    return verify_token(token)
