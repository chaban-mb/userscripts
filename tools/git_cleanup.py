import subprocess
import sys

def run(cmd):
    print(f"> {cmd}")
    res = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if res.returncode != 0:
        print(res.stderr)
        return False
    print(res.stdout)
    return True

def main():
    if len(sys.argv) < 2:
        print("Usage: python git_cleanup.py <branch_name> [main_branch]")
        sys.exit(1)
    
    branch = sys.argv[1]
    main_branch = sys.argv[2] if len(sys.argv) > 2 else "main"
    
    # Check if upstream remote exists, otherwise fallback to origin
    res = subprocess.run("git remote get-url upstream", shell=True, capture_output=True)
    remote = "upstream" if res.returncode == 0 else "origin"
    
    # 1. Sync Main Branch
    if not run(f"git checkout {main_branch}"): return
    if not run(f"git fetch {remote}"): return
    if not run(f"git merge {remote}/{main_branch}"): return
    if not run(f"git push origin {main_branch}"): return
    
    # 2. Delete Local Feature Branch
    if not run(f"git branch -d {branch}"):
        print(f"Warning: Standard local delete failed (often happens on squash merges). Trying force delete...")
        run(f"git branch -D {branch}")
        
    # 3. Delete Remote Feature Branch from Fork
    run(f"git push origin --delete {branch}")
    
    # 4. Prune Remote Tracking branches
    run("git fetch --prune origin")
    print("Git synchronization and cleanup complete!")

if __name__ == "__main__":
    main()
