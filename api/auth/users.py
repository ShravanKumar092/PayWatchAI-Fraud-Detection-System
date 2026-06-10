from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import User
from .security_v2 import hash_password, verify_password

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/register")
def register(email: str, password: str, phone: str, db: Session = Depends(get_db)):
    normalised_email = email.strip().lower()
    if db.query(User).filter(User.email == normalised_email).first():
        raise HTTPException(400, "Email already registered")

    user = User(
        name=normalised_email.split("@")[0],
        email=normalised_email,
        password=hash_password(password),
        phone=phone,
        role="USER",
    )
    db.add(user)
    db.commit()
    return {"status": "success", "email": normalised_email}


__all__ = ["hash_password", "verify_password", "router"]
