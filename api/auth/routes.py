from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import traceback
from .db import get_db
from .models import User
# New hashing / token utilities
from .security_v2 import hash_password, verify_password as verify_password_v2, create_access_token
# Legacy verifier for users created before the upgrade (passlib-based)
from .security import verify_password as legacy_verify_password
from pydantic import BaseModel

router = APIRouter()

# Request Body Schema
class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "user"

@router.post("/signup")
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    try:
        # Validate input
        if not req.name or not req.name.strip():
            raise HTTPException(status_code=400, detail="Name is required")
        if not req.email or not req.email.strip():
            raise HTTPException(status_code=400, detail="Email is required")
        if not req.password:
            raise HTTPException(status_code=400, detail="Password is required")
        if len(req.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        if len(req.password.encode('utf-8')) > 1000:  # Reasonable upper limit
            raise HTTPException(status_code=400, detail="Password is too long (maximum 1000 characters)")
        
        # Normalize email to lowercase
        email = req.email.strip().lower()
        
        # Check if user already exists
        exists = db.query(User).filter(User.email == email).first()
        if exists:
            raise HTTPException(status_code=400, detail="Email already registered")

        # Normalize role (convert to uppercase to match model default)
        role = req.role.upper() if req.role else "USER"
        if role not in ["USER", "ADMIN"]:
            role = "USER"

        # Hash password (uses SHA256 pre-hashing + bcrypt, supports any password length)
        # Temporary simplification to rule out hashing issues
        try:
            hashed_password = hash_password(req.password)
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            print(f">>> Password hashing error: {error_trace}")
            raise HTTPException(status_code=400, detail="Password hashing error. Please try a different password.")

        # Create new user
        user = User(
            name=req.name.strip(),
            email=email,
            password=hashed_password,
            role=role
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        
        return {
            "status": "ok",
            "message": "User registered successfully",
            "name": user.name,
            "email": user.email,
            "role": user.role
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback
        error_trace = traceback.format_exc()
        print(f">>> Signup error: {error_trace}")
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")
class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    try:
        # Normalize email to lowercase (same as signup)
        email = req.email.strip().lower() if req.email else ""

        if not email:
            raise HTTPException(status_code=400, detail="Email is required")
        if not req.password:
            raise HTTPException(status_code=400, detail="Password is required")

        # Find user by normalized email
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        # Verify password (support both new and legacy hashes)
        is_valid = False
        try:
            # Try new hashing scheme first
            is_valid = verify_password_v2(req.password, user.password)
        except Exception:
            is_valid = False

        if not is_valid:
            try:
                # Fallback: try legacy verifier for old accounts
                is_valid = legacy_verify_password(req.password, user.password)
            except Exception:
                is_valid = False

        if not is_valid:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        token = create_access_token({"email": user.email, "role": user.role})
        return {
            "status": "ok",
            "access_token": token,
            "role": user.role
        }
    except HTTPException:
        raise
    except Exception:
        print(">>> Login error:")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Login failed. Please try again.")
